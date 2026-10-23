-- MediaWatch — миграция 0059: уведомления о новых главах и выпусках
--
-- Крон check-episodes теперь проверяет не только аниме и кино, но и мангу
-- (Remanga), ранобэ (Renovels) и подкасты (RSS) — по тайтлам со статусом
-- «Читаю/Слушаю» в списке. Механизм тот же: title_episode_baseline помнит,
-- сколько юнитов было, episode_notifications получает строку на каждый
-- прирост.
--
-- Что меняется:
--   • title_episode_baseline допускает manga/ranobe/podcast (episode_
--     notifications расширили ещё в 0053). Книги — нет: новых глав у книги
--     не бывает.
--   • shikimori_id в обеих таблицах — bigint: id подкаста Apple бывает
--     больше int32 (6822037200), как и в 0051 для таблиц прогресса.
--
-- Применять вручную через Supabase SQL Editor после 0058.

alter table episode_notifications alter column shikimori_id type bigint;
alter table title_episode_baseline alter column shikimori_id type bigint;

-- В 0005 ограничение задано inline — у него автоимя.
alter table title_episode_baseline
  drop constraint if exists title_episode_baseline_content_type_check;
alter table title_episode_baseline
  add constraint title_episode_baseline_content_type_check
  check (content_type in ('anime', 'cinema', 'podcast', 'manga', 'ranobe'));
