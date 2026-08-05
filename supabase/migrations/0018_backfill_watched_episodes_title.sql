-- MediaWatch — миграция 0018: разовый бэкафилл title/poster в watched_episodes
-- Миграция 0017 добавила колонки anime_title/poster_url, но api/progress
-- писал их с ignoreDuplicates: true (ON CONFLICT DO NOTHING) — для серий,
-- уже отмеченных ДО этого изменения, повторная отметка молча игнорировалась
-- и title/poster так и оставались NULL («Без названия» в истории просмотра).
-- Код уже исправлен (обычный upsert с обновлением), эта миграция — разовое
-- заполнение задним числом того, что уже накопилось.

-- Шаг 1: из watch_progress — есть почти для всего, что активно смотрели.
update watched_episodes we
set anime_title = wp.anime_title,
    poster_url = wp.poster_url
from watch_progress wp
where we.user_id = wp.user_id
  and we.content_type = wp.content_type
  and we.shikimori_id = wp.shikimori_id
  and we.anime_title is null;

-- Шаг 2: из user_list — на случай, если прогресс по тайтлу уже удалили
-- (досмотрено и убрано), а статус в списке остался.
update watched_episodes we
set anime_title = ul.anime_title,
    poster_url = ul.poster_url
from user_list ul
where we.user_id = ul.user_id
  and we.content_type = ul.content_type
  and we.shikimori_id = ul.shikimori_id
  and we.anime_title is null;
