-- MediaWatch — миграция 0030: взвешенный рейтинг для сортировки кино
--
-- ЗАЧЕМ. Сортировка «По рейтингу» выдавала первыми безвестные фильмы
-- 1984-1998 годов с оценкой ровно 10.00 — это идеальный балл от двух-трёх
-- голосов. Таких в базе 698 штук с оценкой ≥9.5 и меньше чем двадцатью
-- голосами, и они полностью занимали первую страницу, выталкивая всё, что
-- люди действительно смотрели.
--
-- Просто отбросить их порогом нельзя: у 11,6 тысячи тайтлов меньше пяти
-- голосов, и целый пласт каталога пропал бы из сортировки вовсе.
--
-- Поэтому байесовское сглаживание — тот же приём, что у рейтинга IMDb:
--
--   weighted = (v / (v + m)) * R + (m / (v + m)) * C
--
-- где v — число голосов, R — оценка, m — «вес доверия» (50 голосов),
-- C — средняя оценка по каталогу среди тайтлов с 50+ голосами (6.464,
-- посчитано по факту). Тайтл с двумя голосами и десяткой получает 6.60 и
-- уезжает в середину; тайтл с пятью тысячами голосов и 8.5 остаётся 8.48.
--
-- Показываем при этом по-прежнему НАСТОЯЩУЮ оценку TMDB: подменять число на
-- карточке сглаженным значило бы врать про рейтинг. Взвешенный нужен только
-- для порядка.

alter table cinema_ratings add column if not exists rating_weighted numeric(4,2);
alter table cinema_index add column if not exists rating_weighted numeric(4,2);

create index if not exists cinema_index_batch_rating_w_idx
  on cinema_index (batch_id, rating_weighted desc nulls last);

-- Разовый пересчёт по уже собранным данным: голоса давно лежат в
-- cinema_ratings, никаких новых запросов к TMDB для этого не нужно.
update cinema_ratings
set rating_weighted = round(
      (coalesce(votes, 0)::numeric / (coalesce(votes, 0) + 50)) * rating
      + (50::numeric / (coalesce(votes, 0) + 50)) * 6.464,
      2)
where rating is not null;

-- И сразу в активную партию, чтобы не ждать ночной перестройки.
update cinema_index i
set rating_weighted = r.rating_weighted
from cinema_ratings r
where i.imdb_id = r.imdb_id and r.rating_weighted is not null;
