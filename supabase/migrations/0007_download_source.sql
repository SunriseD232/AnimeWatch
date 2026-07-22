-- MediaWatch — миграция 0007: колонка source в download_queue
-- Применить через Supabase SQL Editor.
--
-- DownloadButton.tsx всегда отправлял source ('anilibria'|'alloha'|'videoseed'),
-- но колонки не было — API его молча отбрасывал, бот сам заново выбирал
-- источник по content_type, игнорируя то, что реально смотрел пользователь.

alter table download_queue
  add column if not exists source text
    check (source in ('anilibria', 'alloha', 'videoseed'));
