-- MediaWatch — миграция 0056: каталог манги
--
-- ИСТОЧНИК — Remanga (`api.remanga.org/api`). Публичный JSON API отдаёт
-- каталог, поиск, карточку тайтла, оглавление и страницы главы. Тайтл
-- открывается по слагу `dir`:
--   /manga/{dir}
--   /manga/read/{dir}/{chapterId}
--
-- ПОЧЕМУ REMANGA. Числовой id тайтла ложится в существующий bigint
-- shikimori_id прогресса без отдельного суррогатного ключа. У источника есть
-- и бесплатные, и платные главы; страницы платных не отдаются без покупки, и
-- обходить это нельзя. Бесплатные читаются прямо на сайте.
--
-- ЗАЧЕМ ИНДЕКС. У каталога Remanga разные сортировки дают разные срезы —
-- просмотры, рейтинг, длина, новинки. Ночной крон обходит их и склеивает
-- витрину. Поиск по названию и «продолжить чтение» должны работать, даже
-- если API источника временно недоступен.
--
-- ЧТО ХРАНИМ. Только лёгкие метаданные: id, слаг, название, тип, год,
-- рейтинг, голоса, просмотры, число глав, обложку. Описание, жанры,
-- оглавление и страницы глав — live. СТРАНИЦЫ (картинки) НЕ ХРАНИМ ВООБЩЕ:
-- они запрашиваются при открытии главы и сразу подписываются через прокси.
--
-- Как у книг и ранобэ, здесь нет batch_id: витрина — это in_catalog + rank.
-- Строки, пришедшие из поиска, остаются ради карточек и «продолжить».
--
-- Применять вручную через Supabase SQL Editor после 0053/0054/0055.

create table if not exists manga_index (
  -- id тайтла у Remanga. Он же shikimori_id прогресса.
  title_id bigint primary key,

  -- Слаг для /manga/{dir} и /api/titles/{dir}/. Уникален у источника.
  dir text not null unique,

  title text not null,
  -- Второе название (обычно английское/оригинальное).
  original_title text,
  -- Третье название (another_name у Remanga); в поиске участвует наравне.
  alternative_title text,

  -- Тип у источника: «Манга», «Манхва», «Маньхуа», «Руманга».
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

-- Поиск по подстроке — триграммами, как у аниме/кино/книг/ранобэ.
create extension if not exists pg_trgm;
create index if not exists manga_index_title_trgm_idx
  on manga_index using gin (title gin_trgm_ops);
create index if not exists manga_index_original_title_trgm_idx
  on manga_index using gin (original_title gin_trgm_ops);
create index if not exists manga_index_alternative_title_trgm_idx
  on manga_index using gin (alternative_title gin_trgm_ops);

-- Витрина: только строки каталога, по порядку.
create index if not exists manga_index_catalog_rank_idx
  on manga_index (rank nulls last)
  where in_catalog;

-- Фильтр по типу в каталоге.
create index if not exists manga_index_kind_idx
  on manga_index (kind)
  where in_catalog;

-- ─────────────────────────────────────────────────────────────
-- Состояние ночной пересборки витрины
-- ─────────────────────────────────────────────────────────────
create table if not exists manga_index_state (
  id boolean primary key default true check (id),
  built_at timestamptz,
  titles_count integer not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into manga_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
alter table manga_index enable row level security;
alter table manga_index_state enable row level security;

create policy "anyone can read manga" on manga_index for select using (true);
create policy "anyone can read manga index state" on manga_index_state for select using (true);

-- Пишет только крон и серверный код с service_role. Политик INSERT/UPDATE для
-- обычных пользователей нет намеренно: витрина и «докладывание» метаданных
-- из поиска идут с сервера, а не из браузера.
grant select on manga_index to authenticated, anon;
grant select on manga_index_state to authenticated, anon;
