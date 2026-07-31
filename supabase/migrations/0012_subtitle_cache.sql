-- Внешние субтитры через OpenSubtitles (см. lib/subtitles/opensubtitles.ts) —
-- в отличие от resolved_streams (15-минутный TTL, ссылки апстрима протухают),
-- тут кэш НАВСЕГДА: текст субтитров серии не меняется, а бесплатный тариф
-- API даёт всего 100 скачиваний/сутки НА ВЕСЬ САЙТ — каждый повторный поиск
-- одной и той же серии без кэша тратил бы эту квоту заново.
--
-- vtt = null — тоже валидный кэш: "искали, не нашли/не прошло валидацию",
-- чтобы не бить по API повторно на каждый визит серии без субтитров.
create table if not exists subtitle_cache (
  content_type text not null,
  shikimori_id bigint not null,
  season integer not null default 1,
  episode integer not null,
  lang text not null default 'ru',
  vtt text,
  created_at timestamptz not null default now(),
  primary key (content_type, shikimori_id, season, episode, lang)
);

-- Тот же паттерн, что и resolved_streams (см. 0007): без единой policy —
-- доступ только серверному коду через service_role.
alter table subtitle_cache enable row level security;
