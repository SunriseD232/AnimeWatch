-- MediaWatch — миграция 0009: кэш нескольких качеств Kodik
-- Применить через Supabase SQL Editor.
--
-- Kodik отдаёт отдельную m3u8-ссылку на каждое качество (360/480/720...),
-- а не один master.m3u8 с ABR-вариантами — /api/proxy синтезирует master
-- сам (см. src/lib/extract/proxy.ts synthesizeMasterPlaylist). Чтобы это
-- работало и на попадании в кэш (не только на свежем извлечении), список
-- качеств нужно хранить вместе с остальной строкой resolved_streams.
alter table resolved_streams add column if not exists qualities jsonb;
