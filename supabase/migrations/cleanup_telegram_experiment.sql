-- MediaWatch — очистка эксперимента с Telegram-ботом.
-- Применить через Supabase SQL Editor — ОДНОКРАТНО, вручную, как и все
-- остальные миграции.
--
-- Не часть пронумерованной последовательности 0001..000N: телеграм-бот и
-- очередь скачивания разрабатывались только в ветке telegram-download-fixes
-- и никогда не попадали в main (в main миграция 0006 — это
-- system_notifications, ничего общего с download_queue). Эта фича
-- признана лишней и удалена из кода — вместо неё прямой прокси-стриминг
-- (см. §12 ARCHITECTURE.md). Если вы вручную применяли старые
-- 0006_download_queue.sql / 0007_download_source.sql / 0008_stream_files.sql
-- при тестировании этой ветки — выполните скрипт ниже, чтобы убрать их
-- следы. Если не применяли — скрипт ничего не сделает (везде IF EXISTS).

-- DROP TABLE снимает таблицу со всех публикаций автоматически — отдельный
-- ALTER PUBLICATION ... DROP TABLE не нужен (и упал бы, если её там нет).
drop function if exists claim_download_task();

drop table if exists telegram_stream_files;
drop table if exists download_queue;
drop table if exists telegram_verifications;
drop table if exists telegram_links;
