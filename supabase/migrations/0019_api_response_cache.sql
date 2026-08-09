-- MediaWatch — миграция 0019: общий кэш ответов внешних API (Kodik/Videoseed/Vibix)
-- Применить через Supabase SQL Editor.
--
-- До этой миграции списки озвучек Kodik/Videoseed и embed Vibix кэшировались
-- только через fetch(..., {next:{revalidate}}) — это кэш В ПАМЯТИ ОДНОГО
-- процесса. Сайт работает в PM2 cluster_mode на нескольких процессах без
-- общей памяти (см. `pm2 describe mediawatch-web` — instances 2 и 3), поэтому
-- один и тот же тайтл, открытый дважды подряд, мог попасть на разные
-- процессы и каждый раз тянуть Kodik/Videoseed/Vibix заново — несколько
-- лишних секунд на полной загрузке страницы, даже когда сам извлечённый
-- видеопоток (resolved_streams) уже был тёпл.
--
-- Эта таблица — тот же принцип, что и resolved_streams, но для произвольных
-- JSON-результатов внешних API, а не только прямых видео-ссылок.

create table if not exists api_response_cache (
  cache_key text primary key,
  response jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists api_response_cache_expires_idx
  on api_response_cache (expires_at);

-- RLS без единой policy — доступ только серверному коду через service_role
-- (те же основания, что и у resolved_streams в 0007).
alter table api_response_cache enable row level security;
