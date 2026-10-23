-- MediaWatch — миграция 0052: каталог подкастов
--
-- Как в фильмах: у себя держим только идентификаторы и лёгкие метаданные
-- (название, автор, обложка, жанр, регион, язык). Эпизоды и аудио НЕ храним
-- вовсе — они читаются из RSS на лету, см. lib/podcasts.ts.
--
-- Наполняет ночной крон (iTunes Search по регионам, батчами), читают все —
-- это публичный каталог, как anime_index/cinema_index.
--
-- Переключатель активной партии тот же приём, что в 0025: крон пишет строки
-- со своим batch_id и переключает указатель, только когда партия целиком
-- собрана. Оборвался — читатели продолжают видеть прошлую.
--
-- Применять после 0051.

-- ─────────────────────────────────────────────────────────────
-- Сам индекс подкастов
-- ─────────────────────────────────────────────────────────────
create table if not exists podcast_index (
  batch_id uuid not null,
  -- Apple collectionId. bigint, потому что id уже бывает больше int32
  -- (например, 6822037200 в топе RU), см. миграцию 0051.
  collection_id bigint not null,

  title text not null,
  author text,
  description text,
  artwork_original text,
  genre text,
  -- ISO-код страны каталога ('us', 'ru', …) — по нему фильтр региона.
  country text,
  -- Код языка фида ('ru', 'en', …) — отдельным полем от страны: язык и
  -- регион совпадают не всегда (русскоязычное шоу в немецком каталоге).
  language text,
  episode_count integer,

  -- Позиция в выдаче iTunes по региону (1 — первый результат). По ней
  -- сортируем «популярное»: своего рейтинга у подкастов нет.
  rank integer,
  released_at timestamptz,

  primary key (batch_id, collection_id)
);

-- Поиск — триграммами, как у аниме/кино (см. миграцию 0034): пользователь
-- вводит «реализация ии», и совпадение находится по подстроке, а не только
-- по целому слову. Один GIN-индекс на оба поля.
create extension if not exists pg_trgm;
create index if not exists podcast_index_title_trgm_idx
  on podcast_index using gin (title gin_trgm_ops);
create index if not exists podcast_index_author_trgm_idx
  on podcast_index using gin (author gin_trgm_ops);

-- Основные выборки каталога начинаются с активной партии, поэтому batch_id
-- первым во всех составных индексах (тот же принцип, что в 0025).
create index if not exists podcast_index_batch_rank_idx
  on podcast_index (batch_id, rank nulls last);
create index if not exists podcast_index_batch_country_idx
  on podcast_index (batch_id, country);
create index if not exists podcast_index_batch_released_idx
  on podcast_index (batch_id, released_at desc nulls last);

-- ─────────────────────────────────────────────────────────────
-- Указатель на активную партию
-- ─────────────────────────────────────────────────────────────
create table if not exists podcast_index_state (
  id boolean primary key default true check (id),
  active_batch uuid,
  built_at timestamptz,
  titles_count integer not null default 0,
  -- Для диагностики: сколько партия шла и чем закончилась прошлая попытка.
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into podcast_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
alter table podcast_index enable row level security;
alter table podcast_index_state enable row level security;

create policy "anyone can read podcasts" on podcast_index for select using (true);
create policy "anyone can read podcast index state" on podcast_index_state for select using (true);

-- Явный грант — RLS policy без него не работает (та же грабля, что в 0020/0021/0025).
grant select on podcast_index to authenticated, anon;
grant select on podcast_index_state to authenticated, anon;

-- Пишет только крон под service_role (обходит RLS), права ему даны
-- default privileges из 0014.
