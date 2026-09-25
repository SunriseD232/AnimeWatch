-- MediaWatch — миграция 0042: локальный кэш hero-обложек (backdrop)
--
-- Зеркало poster_cache (миграция 0029), но НЕ на весь каталог — только на
-- узкий набор тайтлов, которые реально стали чьим-то hero сегодня (см.
-- lib/recommendationsEngine.ts). Отдельная таблица, а не переиспользование
-- poster_cache: разный масштаб (единицы/десятки записей в сутки против
-- полного каталога) и разный размер файла (hero — широкий баннер, не
-- карточка 2:3), смешивать их в одном реестре с одной колонкой bytes/width/
-- height было бы не про одно и то же.
create table if not exists backdrop_cache (
  kind text not null,             -- 'anime' | 'cinema' — подпапки в BACKDROP_DIR
  source_id integer not null,     -- shikimori_id / kp_id
  source_url text,                -- откуда скачали — по нему ловим смену обложки у апстрима
  bytes integer,
  width integer,
  height integer,
  fetched_at timestamptz not null default now(),
  miss_count integer not null default 0,
  primary key (kind, source_id)
);

create index if not exists backdrop_cache_fetched_idx
  on backdrop_cache (kind, fetched_at asc nulls first);

alter table backdrop_cache enable row level security;
create policy "anyone can read backdrop cache" on backdrop_cache for select using (true);
grant select on backdrop_cache to authenticated, anon;
