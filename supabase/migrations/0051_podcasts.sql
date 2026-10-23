-- MediaWatch — миграция 0051: подкасты
--
-- Первый «не видео»-раздел. Прогресс прослушивания переиспользует те же
-- таблицы, что и просмотр: watch_progress (текущий эпизод/позиция),
-- watched_episodes (дослушанные эпизоды) и user_list (на будущее).
--
-- ВАЖНО про shikimori_id. Колонка исторически integer и хранит внешний id:
--   content_type='anime'   → shikimori_id
--   content_type='cinema'  → kinopoisk_id
--   content_type='podcast' → Apple collectionId
-- Apple collectionId уже сейчас бывает больше 2 147 483 647 (например,
-- 6822037200 в топе подкастов RU), поэтому integer физически не хватает.
-- bigint в JS остаётся безопасным числом (Apple id < 2^53), так что типы
-- на клиенте менять не нужно.
--
-- Применять вручную через Supabase SQL Editor после 0050.

-- =========================================================
-- 1. Расширяем числовой id до bigint
-- =========================================================

alter table watch_progress alter column shikimori_id type bigint;
alter table user_list alter column shikimori_id type bigint;
alter table watched_episodes alter column shikimori_id type bigint;

-- =========================================================
-- 2. Разрешаем content_type='podcast'
-- =========================================================

alter table watch_progress
  drop constraint if exists watch_progress_content_type_check;
alter table watch_progress
  add constraint watch_progress_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast'));

alter table user_list
  drop constraint if exists user_list_content_type_check;
alter table user_list
  add constraint user_list_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast'));

-- В 0004 ограничение задано inline, Postgres дал ему автоимя
-- watched_episodes_content_type_check.
alter table watched_episodes
  drop constraint if exists watched_episodes_content_type_check;
alter table watched_episodes
  add constraint watched_episodes_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast'));
