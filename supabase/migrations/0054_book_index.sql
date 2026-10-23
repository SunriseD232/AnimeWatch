-- MediaWatch — миграция 0054: каталог книг
--
-- ЗАЧЕМ ИНДЕКС, ЕСЛИ У ФЛИБУСТЫ ЕСТЬ OPDS-ПОИСК. У Флибусты нет эндпоинта
-- «одна книга по id»: `/opds/book/{id}` отдаёт корневой каталог (проверено
-- живьём 23.10.2026), а поиск по числу ничего не находит. То есть карточку
-- книги по id открыть нечем — а без карточки некуда вести из сетки каталога
-- и из «продолжить чтение».
--
-- Решение: у себя держим лёгкие метаданные (название, автор, жанры,
-- аннотация, обложка, размер). Строки попадают сюда двумя путями:
--   1) ночной крон обходит OPDS (новинки + жанры) и помечает in_catalog;
--   2) любой показ результата поиска «докладывает» книгу upsert-ом, чтобы
--      карточка открылась, даже если её нет в текущей партии каталога.
-- ФАЙЛЫ НЕ ХРАНИМ: epub/fb2 качаются с Флибусты по требованию через
-- подписанный прокси (см. lib/books.ts), на диске ничего не оседает.
--
-- В отличие от anime_index/cinema_index/podcast_index здесь НЕТ batch_id.
-- Те книги, что уже показаны в каталоге, не должны пропадать между партиями:
-- у Флибусты каталог не «пересобирается» раз в сутки, а только пополняется.
-- Поэтому таблица — постоянный кэш метаданных, а не сменяемая партия.
--
-- Применять вручную через Supabase SQL Editor после 0053.

create table if not exists book_index (
  -- id Флибусты (число из ссылки /b/{id}/...). Он же shikimori_id прогресса.
  book_id bigint primary key,

  title text not null,
  author text,
  -- Короткая аннотация из OPDS. Длинную не храним: в поиске она не участвует,
  -- а таблицу раздувает в разы.
  annotation text,
  genres text[] not null default '{}',
  language text,
  -- Доступные форматы: 'epub', 'fb2'. Массив, а не набор колонок: у книги
  -- обычно оба, но бывает только fb2.
  formats text[] not null default '{}',
  size_bytes bigint,
  downloads integer,
  year smallint,
  cover_url text,
  -- Прямая ссылка на страницу книги у источника.
  source_url text not null,

  -- Порядок в витрине каталога (1 — первый). Заполняет крон; у книг, которые
  -- попали сюда только из поиска, rank = null и в витрину они не входят.
  rank integer,
  -- true — книга в текущей витрине каталога (её нашёл крон). При пересборке
  -- витрины ставим false всем, затем true найденным — так из каталога уходят
  -- книги, которые Флибуста убрала, а метаданные для карточек остаются.
  in_catalog boolean not null default false,

  updated_at timestamptz not null default now()
);

-- Поиск — триграммами, как у аниме/кино/подкастов (миграция 0034): «стругац»
-- находит «Стругацкий», «понедельник» — «Понедельник начинается в субботу».
create extension if not exists pg_trgm;
create index if not exists book_index_title_trgm_idx
  on book_index using gin (title gin_trgm_ops);
create index if not exists book_index_author_trgm_idx
  on book_index using gin (author gin_trgm_ops);

-- Витрина: активные книги по порядку. Частичный индекс — в нём только строки
-- каталога, которых обычно меньше, чем накопленных из поиска.
create index if not exists book_index_catalog_rank_idx
  on book_index (rank nulls last)
  where in_catalog;

-- Фильтр по жанру в каталоге. GIN по массиву.
create index if not exists book_index_genres_idx
  on book_index using gin (genres);

-- ─────────────────────────────────────────────────────────────
-- Состояние ночной пересборки витрины
-- ─────────────────────────────────────────────────────────────
create table if not exists book_index_state (
  id boolean primary key default true check (id),
  built_at timestamptz,
  titles_count integer not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into book_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
alter table book_index enable row level security;
alter table book_index_state enable row level security;

create policy "anyone can read books" on book_index for select using (true);
create policy "anyone can read book index state" on book_index_state for select using (true);

-- Пишет только крон и серверный код с service_role (обходит RLS): и витрину,
-- и «докладывание» метаданных из поиска. Политик INSERT/UPDATE для обычных
-- пользователей нет намеренно: поиском пользуются и анонимы, а RLS-политика
-- «можно править строки вне витрины» позволила бы любому авторизованному
-- переписать название/автора/обложку чужих найденных книг. Серверный код
-- (rememberBooks в lib/books.ts) вместо этого делает upsert с
-- ignoreDuplicates: существующие строки не меняются вообще.
grant select on book_index to authenticated, anon;
grant select on book_index_state to authenticated, anon;
