-- MediaWatch — миграция 0035: на watched_episodes не было UPDATE-ПОЛИТИКИ
-- Применить после 0034.
--
-- Продолжение истории миграции 0020. Там выдали UPDATE-ГРАНТ, потому что
-- upsert из /api/progress перестал быть ON CONFLICT DO NOTHING и стал
-- ON CONFLICT DO UPDATE. Грант помог, но у таблицы включён RLS, а из четырёх
-- политик 0004 создала только select/insert/delete. Для UPDATE политики нет
-- вовсе — а «нет политики» при включённом RLS означает «запрещено всем».
-- Поэтому ошибка не исчезла, а сменила текст: вместо "permission denied for
-- table" стало
--   new row violates row-level security policy (USING expression)
-- и падает она ровно тогда, когда конфликт РЕАЛЬНО происходит, то есть при
-- ПОВТОРНОЙ отметке уже отмеченной серии.
--
-- Воспроизведено на проде 12.09.2026: тот же insert ... on conflict do update
-- под ролью authenticated с jwt реального пользователя падает с этим текстом,
-- в логах web — 11 таких строк.
--
-- Чем это било по пользователю:
--  * «История» в профиле не пополнялась при пересмотре серии;
--  * хуже — /api/progress на этой ошибке отдаёт 500 и ВЫХОДИТ РАНЬШЕ, чем
--    обработает флаг completed, так что досмотренный до конца тайтл не
--    попадал в «Просмотрено»;
--  * ручная отметка серии в сетке (EpisodeGrid/CinemaEpisodes пишут в таблицу
--    напрямую из браузера) показывала пользователю красный тост с этим же
--    текстом.
--
-- watched_episodes — единственная таблица проекта, у которой UPDATE-политики
-- не было: у watch_progress, user_list, user_theme, user_presence она есть.

drop policy if exists "own watched update" on watched_episodes;

create policy "own watched update" on watched_episodes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
