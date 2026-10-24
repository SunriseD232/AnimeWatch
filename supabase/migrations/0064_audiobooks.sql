-- MediaWatch — миграция 0064: аудиокниги (knigavuhe.org)
--
-- ЗАЧЕМ. Раздел «Аудиокниги» в «Слушать» и связь аудиокниг с книгами
-- Флибусты: на карточке книги — её озвучки, а место в книге и в записи
-- синхронизируется (lib/bookAudioSync.ts).
--
--   1. audiobook_index — одна строка на одну озвучку knigavuhe (у одной книги
--      их бывает несколько: разные чтецы). Пишет еженедельный полный обход
--      списка и ночной обход новинок (lib/audiobookIndex.ts). Главы и mp3 в
--      индексе не хранятся — их берёт страница книги при открытии.
--   2. Сопоставление с book_index — match_audiobooks(): то же произведение =
--      то же название (после нормализации) и та же фамилия автора. Из изданий
--      произведения во Флибусте (их бывают десятки) — самое скачиваемое.
--      Не нашлось — book_id пуст, аудиокнига живёт своей карточкой.
--   3. Тип контента 'audiobook' в таблицах прогресса, списков, истории,
--      уведомлений, оценок и комментариев: id knigavuhe и id Флибусты —
--      разные пространства, смешивать их под 'book' нельзя.
--
-- Применять после 0063.

-- Как в 0061: `set pg_trgm.…` у функции роль postgres может задать только
-- после загрузки библиотеки pg_trgm в сеансе.
select show_trgm('a');

-- ─────────────────────────────────────────────────────────────
-- 1. Индекс аудиокниг
-- ─────────────────────────────────────────────────────────────
create table if not exists audiobook_index (
  -- id knigavuhe: из пути обложки (/covers/{id}/) и из BookPlayer({id}).
  id bigint primary key,
  -- Адрес страницы: knigavuhe.org/book/{slug}/.
  slug text not null,
  title text not null,
  authors text[] not null default '{}',
  -- Авторы одной строкой — для поиска (триграммы) и сопоставления.
  authors_text text,
  readers text[] not null default '{}',
  genres text[] not null default '{}',
  annotation text,
  duration_seconds integer,
  cover_url text,
  views integer,
  likes integer,
  -- Пара во Флибусте (book_index.book_id) и уверенность: 1 — то же название,
  -- меньше — похожее. Пусто — пары нет.
  book_id bigint,
  match_confidence real,
  matched_at timestamptz,
  in_catalog boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table audiobook_index is
  'Аудиокниги knigavuhe.org. Пишет lib/audiobookIndex.ts, сопоставление — match_audiobooks().';

create index if not exists audiobook_index_title_trgm_idx
  on audiobook_index using gin (title gin_trgm_ops);
create index if not exists audiobook_index_authors_trgm_idx
  on audiobook_index using gin (authors_text gin_trgm_ops);
create index if not exists audiobook_index_genres_gin on audiobook_index using gin (genres);
create index if not exists audiobook_index_book_idx on audiobook_index (book_id) where book_id is not null;
create index if not exists audiobook_index_views_idx
  on audiobook_index (views desc nulls last, id) where in_catalog;
create index if not exists audiobook_index_new_idx on audiobook_index (id desc) where in_catalog;

create table if not exists audiobook_index_state (
  id boolean primary key default true check (id),
  built_at timestamptz,
  titles_count integer not null default 0,
  matched_count integer not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);
insert into audiobook_index_state (id) values (true) on conflict (id) do nothing;

alter table audiobook_index enable row level security;
alter table audiobook_index_state enable row level security;
create policy "anyone can read audiobooks" on audiobook_index for select using (true);
create policy "anyone can read audiobook index state" on audiobook_index_state for select using (true);
-- Пишет только крон с service_role, как у остальных индексов.
grant select on audiobook_index to authenticated, anon;
grant select on audiobook_index_state to authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- 2. Сопоставление с книгами
-- ─────────────────────────────────────────────────────────────
-- Название для сравнения: регистр, ё/е, пояснения в скобках («(Аудиоспектакль)»,
-- «[сборник]») и знаки препинания не важны.
create or replace function audiobook_norm_title(value text)
returns text
language sql immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(value, '')), 'ё', 'е'),
      '\s*[\(\[][^\)\]]*[\)\]]', '', 'g'),
    '[^[:alnum:]]+', ' ', 'g'));
$$;

-- Фамилия первого автора — последнее слово «Имя Фамилия», ё → е.
create or replace function audiobook_author_key(authors text[])
returns text
language sql immutable
as $$
  select nullif(translate(lower(regexp_replace(btrim(coalesce(authors[1], '')), '^.*\s', '')), 'ё', 'е'), '');
$$;

-- Сопоставляет до lim аудиокниг, у которых сопоставления ещё не было или
-- строка обновилась после него. Возвращает, сколько обработано и сколько
-- нашли пару. Код зовёт её в цикле, пока processed > 0: одна большая
-- транзакция на 65 тыс. строк упёрлась бы в таймаут запроса.
create or replace function match_audiobooks(lim integer default 2000)
returns table (processed integer, matched integer)
language plpgsql
set pg_trgm.similarity_threshold = 0.6
as $$
declare
  n_processed integer := 0;
  n_matched integer := 0;
  r record;
  -- Не record: у строки без автора поиска нет, и обращение к полям
  -- неприсвоенной записи PL/pgSQL считает ошибкой.
  best_id bigint;
  best_score real;
begin
  for r in
    select a.id, a.title, a.authors
      from audiobook_index a
     where a.matched_at is null or a.matched_at < a.updated_at
     order by a.id
     limit greatest(lim, 1)
  loop
    n_processed := n_processed + 1;
    best_id := null;
    best_score := null;

    if audiobook_author_key(r.authors) is not null then
      -- Кандидаты — по триграммам названия (индекс book_index_title_trgm_idx),
      -- дальше точная проверка: та же фамилия и то же или очень похожее
      -- нормализованное название. Из изданий — самое скачиваемое.
      select b.book_id,
             case when audiobook_norm_title(b.title) = audiobook_norm_title(r.title) then 1.0
                  else similarity(audiobook_norm_title(b.title), audiobook_norm_title(r.title)) end as score
        into best_id, best_score
        from book_index b
       -- Без пояснений в скобках: «… (Аудиоспектакль)» иначе не дотягивал бы
       -- до порога сходства с названием книги.
       where b.title % audiobook_norm_title(r.title)
         and translate(lower(b.author), 'ё', 'е') like '%' || audiobook_author_key(r.authors) || '%'
         and (audiobook_norm_title(b.title) = audiobook_norm_title(r.title)
              or similarity(audiobook_norm_title(b.title), audiobook_norm_title(r.title)) >= 0.85)
       order by score desc, b.downloads desc nulls last, b.book_id
       limit 1;
    end if;

    update audiobook_index
       set book_id = best_id,
           match_confidence = best_score,
           matched_at = now()
     where id = r.id;
    if best_id is not null then
      n_matched := n_matched + 1;
    end if;
  end loop;

  return query select n_processed, n_matched;
end;
$$;

-- Справочник жанров для фильтров каталога.
create or replace function audiobook_catalog_facets()
returns table (facet text, name text, count bigint)
language sql stable
as $$
  select 'genre', g, count(*) from audiobook_index, unnest(genres) g where in_catalog group by g;
$$;

grant execute on function audiobook_catalog_facets() to anon, authenticated, service_role;
grant execute on function match_audiobooks(integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Тип контента 'audiobook'
-- ─────────────────────────────────────────────────────────────
alter table watch_progress drop constraint if exists watch_progress_content_type_check;
alter table watch_progress add constraint watch_progress_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

alter table user_list drop constraint if exists user_list_content_type_check;
alter table user_list add constraint user_list_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

alter table watched_episodes drop constraint if exists watched_episodes_content_type_check;
alter table watched_episodes add constraint watched_episodes_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

alter table episode_notifications drop constraint if exists episode_notifications_content_type_check;
alter table episode_notifications add constraint episode_notifications_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

alter table title_ratings drop constraint if exists title_ratings_content_type_check;
alter table title_ratings add constraint title_ratings_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

alter table episode_comments drop constraint if exists episode_comments_content_type_check;
alter table episode_comments add constraint episode_comments_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe', 'audiobook'));

-- Книг тут нет и не было (у них нет «новых глав»), аудиокнига — для единства
-- с остальными таблицами: появится уведомление о новых главах — не упрёмся.
alter table title_episode_baseline drop constraint if exists title_episode_baseline_content_type_check;
alter table title_episode_baseline add constraint title_episode_baseline_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'manga', 'ranobe', 'audiobook'));
