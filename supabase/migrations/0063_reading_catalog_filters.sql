-- MediaWatch — миграция 0063: фильтры каталогов манги, ранобэ и книг
--
-- ЗАЧЕМ. Каталоги чтения получают ту же панель фильтров, что кино
-- (/manga/catalog, /ranobe/catalog, /books/catalog): жанры и теги с
-- исключением, тип, статус, год, рейтинг, сортировки по дате и рейтингу.
--
--   1. Жанры и теги манги и ранобэ. Remanga и Renovels отдают их прямо в
--      списке каталога (genres и categories), поэтому полный обход пишет их
--      без лишних запросов (lib/catalogIndex.ts). Карточкам только с
--      MangaLib их проставляет обход MangaLib по жанрам и тегам
--      (lib/mangalibCatalog.ts): его список жанров не отдаёт. Хранятся
--      названиями, а не id: у трёх источников свои id, а названия совпадают.
--      У книг жанры есть с 0054; тегов у Флибусты нет.
--   2. Справочники для панели — SQL-функцией: какие жанры/теги/типы/статусы
--      есть в каталоге и сколько у каждого тайтлов. Код кэширует ответ.
--   3. Индексы: GIN под «содержит все» и «не пересекается» (включить /
--      исключить), btree под сортировки по рейтингу и году.
--
-- Применять после 0062.

-- ─────────────────────────────────────────────────────────────
-- 1. Колонки
-- ─────────────────────────────────────────────────────────────
alter table manga_index
  add column if not exists genres text[] not null default '{}',
  add column if not exists tags text[] not null default '{}';

alter table ranobe_index
  add column if not exists genres text[] not null default '{}',
  add column if not exists tags text[] not null default '{}';

comment on column manga_index.genres is 'Жанры (названия, как у источника). Пишет полный обход.';
comment on column manga_index.tags is 'Теги («категории» Remanga, tags MangaLib). Пишет полный обход.';
comment on column ranobe_index.genres is 'Жанры (названия, как у источника). Пишет полный обход.';
comment on column ranobe_index.tags is 'Теги («категории» Renovels). Пишет полный обход.';

-- ─────────────────────────────────────────────────────────────
-- 2. Справочники для панели фильтров
-- ─────────────────────────────────────────────────────────────
-- facet: 'genre' | 'tag' | 'kind' | 'status'. Только то, что сейчас в
-- каталоге: пункт, по которому ничего не найдётся, панели не нужен.
create or replace function manga_catalog_facets()
returns table (facet text, name text, count bigint)
language sql stable
as $$
  select 'genre', g, count(*) from manga_index, unnest(genres) g where in_catalog group by g
  union all
  select 'tag', t, count(*) from manga_index, unnest(tags) t where in_catalog group by t
  union all
  select 'kind', btrim(kind), count(*) from manga_index
   where in_catalog and kind is not null and btrim(kind) <> '' group by btrim(kind)
  union all
  select 'status', btrim(status), count(*) from manga_index
   where in_catalog and status is not null and btrim(status) <> '' group by btrim(status);
$$;

create or replace function ranobe_catalog_facets()
returns table (facet text, name text, count bigint)
language sql stable
as $$
  select 'genre', g, count(*) from ranobe_index, unnest(genres) g where in_catalog group by g
  union all
  select 'tag', t, count(*) from ranobe_index, unnest(tags) t where in_catalog group by t
  union all
  select 'kind', btrim(kind), count(*) from ranobe_index
   where in_catalog and kind is not null and btrim(kind) <> '' group by btrim(kind)
  union all
  select 'status', btrim(status), count(*) from ranobe_index
   where in_catalog and status is not null and btrim(status) <> '' group by btrim(status);
$$;

grant execute on function manga_catalog_facets() to anon, authenticated, service_role;
grant execute on function ranobe_catalog_facets() to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Индексы
-- ─────────────────────────────────────────────────────────────
create index if not exists manga_index_genres_gin on manga_index using gin (genres);
create index if not exists manga_index_tags_gin on manga_index using gin (tags);
create index if not exists ranobe_index_genres_gin on ranobe_index using gin (genres);
create index if not exists ranobe_index_tags_gin on ranobe_index using gin (tags);

-- Сортировки каталога: рейтинг и год (id — последним ключом, как везде).
create index if not exists manga_index_catalog_rating_idx
  on manga_index (rating desc nulls last, title_id) where in_catalog;
create index if not exists manga_index_catalog_year_idx
  on manga_index (year desc nulls last, title_id) where in_catalog;
create index if not exists ranobe_index_catalog_rating_idx
  on ranobe_index (rating desc nulls last, title_id) where in_catalog;
create index if not exists ranobe_index_catalog_year_idx
  on ranobe_index (year desc nulls last, title_id) where in_catalog;
create index if not exists book_index_catalog_year_idx
  on book_index (year desc nulls last, book_id) where in_catalog;
