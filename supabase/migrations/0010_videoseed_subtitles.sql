-- Внешние субтитры (сейчас реально отдаёт только Videoseed, см. коммит) —
-- та же схема кэширования, что и qualities в 0009: колонка на
-- resolved_streams, живёт вместе с остальным резолвом до истечения TTL.
alter table resolved_streams add column if not exists subtitles jsonb;
