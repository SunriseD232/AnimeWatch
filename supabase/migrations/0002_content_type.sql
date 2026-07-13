-- AnimeWatch — миграция 0002: раздел «Фильмы и сериалы»
-- Добавляет тип контента, чтобы в одних таблицах жили и аниме (Shikimori),
-- и фильмы/сериалы (Kodik / Kinopoisk). Применить после 0001.
--
-- ВАЖНО: колонка shikimori_id остаётся общим числовым внешним id:
--   content_type='anime'  → shikimori_id
--   content_type='cinema' → kinopoisk_id
-- Физически колонку не переименовываем, чтобы не трогать рабочий аниме-путь.

-- =========================================================
-- watch_progress
-- =========================================================
alter table watch_progress
  add column if not exists content_type text not null default 'anime';

-- Ограничиваем допустимые значения типа.
alter table watch_progress
  drop constraint if exists watch_progress_content_type_check;
alter table watch_progress
  add constraint watch_progress_content_type_check
  check (content_type in ('anime', 'cinema'));

-- Пересобираем уникальность: теперь ключ учитывает тип контента,
-- иначе kinopoisk_id и shikimori_id могли бы коллидировать.
alter table watch_progress
  drop constraint if exists watch_progress_user_id_shikimori_id_key;
alter table watch_progress
  drop constraint if exists watch_progress_user_content_key;
alter table watch_progress
  add constraint watch_progress_user_content_key
  unique (user_id, content_type, shikimori_id);

-- =========================================================
-- user_list
-- =========================================================
alter table user_list
  add column if not exists content_type text not null default 'anime';

alter table user_list
  drop constraint if exists user_list_content_type_check;
alter table user_list
  add constraint user_list_content_type_check
  check (content_type in ('anime', 'cinema'));

alter table user_list
  drop constraint if exists user_list_user_id_shikimori_id_key;
alter table user_list
  drop constraint if exists user_list_user_content_key;
alter table user_list
  add constraint user_list_user_content_key
  unique (user_id, content_type, shikimori_id);
