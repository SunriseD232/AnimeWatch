-- MediaWatch — миграция 0067: откуда открыть книгу, если Флибуста лежит
--
-- ЗАЧЕМ (24.10.2026). Флибуста лежала целиком, а на нашем диске не было ни
-- одной книги — не открывалось ничего. Теперь файл берётся из первого места,
-- где он есть: наш диск → Флибуста → КулЛиб (lib/books.ts, fetchBookFile).
--
--   1. local_formats — какие форматы книги лежат в кэше на нашем диске
--      (lib/bookCache.ts): всё, что открывали, и запас популярного (крон
--      prefetch-books). По нему — значок «На сервере» и фильтр «Наличие».
--   2. coollib_* — та же книга в КулЛибе (запасной источник): номер, форматы
--      и когда искали. Неудачу тоже помним (coollib_id пуст, checked_at
--      есть): искать каждый раз — лишние запросы к чужому сайту.
--
-- Импорт дампа Флибусты (scripts/flibusta-merge.sql) эти колонки не трогает.
-- Применять после 0066.

alter table book_index
  add column if not exists local_formats text[] not null default '{}',
  add column if not exists coollib_id bigint,
  add column if not exists coollib_formats text[] not null default '{}',
  add column if not exists coollib_checked_at timestamptz;

comment on column book_index.local_formats is 'Форматы книги в кэше на диске VPS (lib/bookCache.ts).';
comment on column book_index.coollib_id is 'Та же книга в КулЛибе (запасной источник файлов); пусто — не нашли или не искали.';

-- Фильтр «Наличие» и значок: книг с копией и с КулЛибом — малая доля
-- каталога, частичные индексы маленькие.
create index if not exists book_index_local_idx
  on book_index (book_id) where cardinality(local_formats) > 0;
create index if not exists book_index_coollib_idx
  on book_index (book_id) where coollib_id is not null;
