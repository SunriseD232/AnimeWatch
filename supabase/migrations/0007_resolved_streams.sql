-- MediaWatch — миграция 0007: кэш прямых видео-ссылок для собственного плеера
-- Применить через Supabase SQL Editor.
--
-- Собственный плеер сайта (см. §12 ARCHITECTURE.md) не хранит и не качает
-- видео целиком: /api/proxy на лету извлекает у эмбед-плеера источника
-- (Alloha, Videoseed) прямую ссылку на .mp4/.m3u8 через headless Chromium
-- (Puppeteer-перехват сети — тот же приём, что раньше использовался для
-- скачивания в Telegram, только без Telegram) и сразу проксирует байты
-- Range-кусками в браузер.
--
-- Puppeteer — дорогая операция (секунды), гонять её на каждый чанк нельзя.
-- Эта таблица — общий кэш результата извлечения: один раз нашли прямую
-- ссылку на серию — используют все пользователи, пока ссылка не истекла.

create table if not exists resolved_streams (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id integer not null,      -- для cinema — kinopoisk_id (как везде)
  season integer not null default 1,
  episode integer not null,
  source text not null check (source in ('alloha', 'videoseed')),
  url text not null,                  -- прямая ссылка на .mp4/.m3u8 у апстрима
  headers jsonb not null default '{}'::jsonb, -- обычно только Referer (хотлинк-защита)
  is_hls boolean not null default false,
  expires_at timestamptz not null,    -- апстрим-ссылки живут недолго — TTL извлечения
  created_at timestamptz not null default now(),
  unique (content_type, shikimori_id, season, episode, source)
);

create index if not exists resolved_streams_lookup_idx
  on resolved_streams (content_type, shikimori_id, season, episode, source);

-- RLS без единой policy: таблица содержит прямые (незащищённые от хотлинка
-- только на бумаге) ссылки апстрима — доступ только серверному коду через
-- service_role, ни anon, ни authenticated её не видят вообще.
alter table resolved_streams enable row level security;
