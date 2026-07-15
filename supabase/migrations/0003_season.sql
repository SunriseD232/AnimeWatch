-- AnimeWatch — миграция 0003: сезоны для сериалов
-- Раздел «Фильмы и сериалы» перешёл на каталог Videoseed, где сериалы разбиты
-- по сезонам. Храним текущий сезон в прогрессе (по-прежнему одна строка на
-- тайтл: user_id + content_type + shikimori_id). Применить после 0002.
--
-- Для аниме и фильмов сезон всегда 1 (default), поэтому существующие строки
-- корректны без обратного заполнения.

alter table watch_progress
  add column if not exists season integer not null default 1;
