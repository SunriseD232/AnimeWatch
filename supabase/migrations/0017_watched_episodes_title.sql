-- MediaWatch — миграция 0017: заголовок/постер на каждой записи watched_episodes
-- Таблица уже пишет watched_at на каждую досмотренную серию (см. миграцию
-- 0004) — фактически это уже полная история просмотра, просто не хватало
-- title/poster, чтобы показать её в профиле без лишних JOIN'ов на user_list
-- (который может не содержать тайтл, если пользователь не добавлял его в
-- список, а просто смотрел).

alter table watched_episodes
  add column if not exists anime_title text,
  add column if not exists poster_url text;
