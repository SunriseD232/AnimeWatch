-- MediaWatch — миграция 0055: каталог ранобэ
--
-- ИСТОЧНИК — Renovels (`api.renovels.org/api`). Он умеет отдать тайтл по
-- слагу `dir`, но НЕ по числовому id (`/api/titles/{id}/` отвечает «тайтл не
-- найден»). Поэтому адреса раздела строятся по слагу:
--   /ranobe/{dir}
--   /ranobe/read/{dir}/{chapterId}
--
-- ЗАЧЕМ ИНДЕКС. Renovels отдаёт каталог и поиск живьём, но:
--   • сортировки у каталога разные и неполные — ни одна не даёт
--     представительную витрину;
--   • живой поиск ранобэ нужен всегда, но при недоступном API страница
--     должна показывать хоть что-то;
--   • «продолжить чтение» и карточки не должны зависеть от того, ответил ли
--     источник прямо сейчас.
--
-- ЧТО ХРАНИМ. Только лёгкие метаданные: id, слаг, название, тип, год,
-- рейтинг, просмотры, число глав, обложку. Описание, жанры и оглавление — не
-- здесь: они берутся live и не раздувают таблицу. ТЕКСТ ГЛАВ НЕ ХРАНИМ ВООБЩЕ:
-- он запрашивается с API в момент чтения и сразу санитизируется.
--
-- В отличие от anime/cinema/podcast-индексов здесь НЕТ batch_id: витрина —
-- это флаг in_catalog + rank. Ночной крон ставит true найденным, false —
-- остальным; записи, пришедшие из поиска, остаются ради карточек.
--
-- Применять вручную через Supabase SQL Editor после 0053/0054.

create table if not exists ranobe_index (
  -- id тайтла у Renovels. Он же shikimori_id прогресса.
  title_id bigint primary key,

  -- Слаг для /ranobe/{dir} и /api/titles/{dir}/. Уникален у источника.
  dir text not null unique,

  title text not null,
  original_title text,
  -- Третье название (another_name у Renovels); в поиске участвует наравне.
  alternative_title text,

  -- Происхождение/тип: «Корея», «Япония», «Китай», «Запад», «Авторское».
  kind text,
  status text,
  year smallint,
  rating real,
  votes integer,
  views bigint,
  chapters_count integer,

  -- Подписанная ссылка на обложку через /api/proxy/raw.
  cover_url text,

  -- Страница тайтла у источника — для атрибуции.
  source_url text not null,

  -- Порядок в витрине (1 — первый). Заполняет крон; у записей, попавших
  -- только из поиска, rank = null и в витрину они не входят.
  rank integer,
  in_catalog boolean not null default false,

  updated_at timestamptz not null default now()
);

-- Поиск по подстроке — триграммами, как у аниме/кино/книг.
create extension if not exists pg_trgm;
create index if not exists ranobe_index_title_trgm_idx
  on ranobe_index using gin (title gin_trgm_ops);
create index if not exists ranobe_index_original_title_trgm_idx
  on ranobe_index using gin (original_title gin_trgm_ops);
create index if not exists ranobe_index_alternative_title_trgm_idx
  on ranobe_index using gin (alternative_title gin_trgm_ops);

-- Витрина: только строки каталога, по порядку.
create index if not exists ranobe_index_catalog_rank_idx
  on ranobe_index (rank nulls last)
  where in_catalog;

-- Фильтр по типу/происхождению в каталоге.
create index if not exists ranobe_index_kind_idx
  on ranobe_index (kind)
  where in_catalog;

-- ─────────────────────────────────────────────────────────────
-- Состояние ночной пересборки витрины
-- ─────────────────────────────────────────────────────────────
create table if not exists ranobe_index_state (
  id boolean primary key default true check (id),
  built_at timestamptz,
  titles_count integer not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into ranobe_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
alter table ranobe_index enable row level security;
alter table ranobe_index_state enable row level security;

create policy "anyone can read ranobe" on ranobe_index for select using (true);
create policy "anyone can read ranobe index state" on ranobe_index_state for select using (true);

-- Пишет только крон и серверный код с service_role. Политик INSERT/UPDATE для
-- обычных пользователей нет намеренно: витрина и «докладывание» метаданных
-- из поиска идут с сервера, а не из браузера.
grant select on ranobe_index to authenticated, anon;
grant select on ranobe_index_state to authenticated, anon;
