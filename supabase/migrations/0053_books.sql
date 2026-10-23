-- MediaWatch — миграция 0053: книги, ранобэ, манга
--
-- Первый раздел НЕ-видео, где юнит — не серия, а «глава», а позиция внутри
-- юнита — не секунда. Поэтому одной строкой «content_type» не обойтись:
--
--   • content_type расширяется до book/manga/ranobe (подкаст уже добавлен в
--     0051). Делаем это сразу для всех трёх типов, а не по одному: применять
--     миграцию вручную в Supabase SQL Editor, и три раза подряд это три
--     шанса ошибиться.
--   • shikimori_id для книг — это id Флибусты (int). Он влезает в bigint
--     после 0051, но НЕ влез бы в исторический int, если однажды Флибуста
--     или ReManga отдадут большой id. Колонка уже bigint — трогать не надо.
--   • source — откуда книга: 'flibusta' | 'remanga' | 'renovels'. Без него
--     id из разных источников могли бы столкнуться: у ReManga и Renovels
--     свои числовые id, и они не связаны ни с Флибустой, ни между собой.
--     Для аниме/кино/подкастов источник однозначен по content_type, и там
--     source останется null.
--   • unit/progress_percent/locator — универсальная позиция. Секунда годится
--     только для видео и звука; книга — это либо проценты (epub.js даёт
--     точный CFI, а процент — приблизительная доля), либо страница (манга).
--
-- Применять вручную через Supabase SQL Editor после 0052.

-- =========================================================
-- 1. Расширяем допустимые типы во всех таблицах с constraint
-- =========================================================

alter table watch_progress
  drop constraint if exists watch_progress_content_type_check;
alter table watch_progress
  add constraint watch_progress_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

alter table user_list
  drop constraint if exists user_list_content_type_check;
alter table user_list
  add constraint user_list_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

alter table watched_episodes
  drop constraint if exists watched_episodes_content_type_check;
alter table watched_episodes
  add constraint watched_episodes_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

-- episode_notifications: уведомления о новых сериях. Для книг/манги это
-- «новая глава», механизм тот же. Расширяем заранее, даже если включать
-- такие уведомления будем позже — constraint менять задним числом дороже.
alter table episode_notifications
  drop constraint if exists episode_notifications_content_type_check;
alter table episode_notifications
  add constraint episode_notifications_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

-- Социальные таблицы: рейтинги, комментарии, вечеринки. Ключ у них тот же
-- (content_type + shikimori_id), тип расширяем, чтобы оценки/комментарии
-- работали и у книг (см. lib/social).
alter table title_ratings
  drop constraint if exists title_ratings_content_type_check;
alter table title_ratings
  add constraint title_ratings_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

alter table episode_comments
  drop constraint if exists episode_comments_content_type_check;
alter table episode_comments
  add constraint episode_comments_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'book', 'manga', 'ranobe'));

-- =========================================================
-- 2. Источник тайтла (для новых типов)
-- =========================================================
-- 'flibusta' | 'remanga' | 'renovels' | 'shikimori' | 'mangadex' | 'itunes'.
-- Null — источник однозначен по content_type (аниме/кино) либо не важен.
-- Длину не ограничиваем сверх разумного: появится новый источник — не нужна
-- миграция ради одного значения.

alter table watch_progress add column if not exists source text;
alter table user_list add column if not exists source text;
alter table watched_episodes add column if not exists source text;

-- =========================================================
-- 3. Универсальная позиция внутри юнита
-- =========================================================
-- unit:
--   seconds — видео и аудио (подкаст): position_seconds
--   percent — книга/ранобэ: progress_percent + locator.cfi
--   page    — манга: position_seconds хранит номер страницы
--   chapter — «отметить главу», без позиции внутри (зарезервировано)
--
-- locator (jsonb) — то, что не влезает в число: cfi epub.js, chapterId,
-- chapterLabel («Том 3, глава 5»), scrollY. Номер главы-ПОРЯДОК живёт в
-- episode (целое, для сортировок и сеток), а человеческая метка — здесь.

alter table watch_progress
  add column if not exists unit text not null default 'seconds',
  add column if not exists progress_percent real,
  add column if not exists locator jsonb;

alter table watch_progress
  drop constraint if exists watch_progress_unit_check;
alter table watch_progress
  add constraint watch_progress_unit_check
  check (unit in ('seconds', 'page', 'chapter', 'percent'));

-- Старые строки (видео/подкасты) — секунды. Дефолт уже проставил это при
-- добавлении колонки, отдельный UPDATE не нужен.
