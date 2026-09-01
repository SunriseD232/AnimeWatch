-- MediaWatch — миграция 0023: разрешить все источники в кэше resolved_streams
-- Применить: docker exec supabase-db psql -U postgres -f <файл> (self-hosted
-- Supabase на VPS — см. reference_vps_deploy) либо через Supabase Studio SQL
-- Editor, если работаешь не с VPS напрямую.
--
-- НАЙДЕНО ВЖИВУЮ (2026-09-01): исходный check-constraint из миграции 0007
-- (create table resolved_streams ... source text check (source in ('alloha',
-- 'videoseed'))) — так и остался только с этими двумя значениями, хотя
-- источников с тех пор стало 7 (см. ExtractSource в types.ts). resolve.ts не
-- проверяет ошибку upsert'а (await без .select()/error-check) — поэтому это
-- не падало заметно, просто ВСЕ запросы Sibnet/Kodik/CVH/Aksor/RealDebrid
-- молча никогда не попадали в кэш: каждый просмотр — полное извлечение
-- заново, включая дорогой цикл RealDebrid (Torrentio-поиск + добавление
-- магнета + поллинг + unrestrict на КАЖДЫЙ запрос вместо одного раза на TTL).
alter table resolved_streams drop constraint if exists resolved_streams_source_check;
alter table resolved_streams add constraint resolved_streams_source_check
  check (source in ('alloha', 'videoseed', 'sibnet', 'kodik', 'cvh', 'aksor', 'realdebrid'));
