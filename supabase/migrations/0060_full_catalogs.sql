-- MediaWatch — миграция 0060: полные каталоги манги, ранобэ и книг
--
-- Каталоги вырастают с тысяч до десятков и сотен тысяч строк: манга и
-- ранобэ — еженедельный полный обход источника (lib/catalogIndex.ts),
-- книги — импорт SQL-дампа Флибусты (scripts/flibusta-import.sh). Что для
-- этого нужно в базе:
--
--   1. Подсчёт чипов (типы манги/ранобэ, жанры книг) — SQL-функциями.
--      Раньше код выгружал колонку и считал сам; PostgREST отдаёт не больше
--      1000 строк, так что и на тысячах чипы считались по первой тысяче, а на
--      сотнях тысяч это было бы бессмысленно и дорого.
--   2. Индексы под новый порядок каталога: витрина (rank), потом остальное по
--      просмотрам/скачиваниям, id последним ключом — без них каждая страница
--      каталога сортировала бы всю таблицу.
--   3. Состояние импорта дампа книг — для /admin/status.
--
-- Применять после 0059.

-- ─────────────────────────────────────────────────────────────
-- 1. Подсчёт чипов
-- ─────────────────────────────────────────────────────────────
create or replace function manga_kind_counts()
returns table (kind text, count bigint)
language sql stable
as $$
  select btrim(kind), count(*)
    from manga_index
   where in_catalog and kind is not null and btrim(kind) <> ''
   group by btrim(kind)
   order by 2 desc;
$$;

create or replace function ranobe_kind_counts()
returns table (kind text, count bigint)
language sql stable
as $$
  select btrim(kind), count(*)
    from ranobe_index
   where in_catalog and kind is not null and btrim(kind) <> ''
   group by btrim(kind)
   order by 2 desc;
$$;

create or replace function book_genre_counts(lim integer default 40)
returns table (genre text, count bigint)
language sql stable
as $$
  select g, count(*)
    from book_index, unnest(genres) as g
   where in_catalog
   group by g
   order by 2 desc
   limit lim;
$$;

grant execute on function manga_kind_counts() to anon, authenticated, service_role;
grant execute on function ranobe_kind_counts() to anon, authenticated, service_role;
grant execute on function book_genre_counts(integer) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. Индексы под порядок каталога (см. getMangaCatalog и соседей)
-- ─────────────────────────────────────────────────────────────
create index if not exists manga_index_catalog_order_idx
  on manga_index (rank asc nulls last, views desc nulls last, title_id)
  where in_catalog;

create index if not exists ranobe_index_catalog_order_idx
  on ranobe_index (rank asc nulls last, views desc nulls last, title_id)
  where in_catalog;

create index if not exists book_index_catalog_order_idx
  on book_index (rank asc nulls last, downloads desc nulls last, book_id desc)
  where in_catalog;

-- Фильтр жанра книг (genres @> '{…}') по сотням тысяч строк.
create index if not exists book_index_genres_gin_idx
  on book_index using gin (genres);

-- ─────────────────────────────────────────────────────────────
-- 3. Состояние импорта дампа Флибусты
-- ─────────────────────────────────────────────────────────────
alter table book_index_state
  add column if not exists dump_imported_at timestamptz,
  add column if not exists dump_books integer,
  add column if not exists dump_error text;
