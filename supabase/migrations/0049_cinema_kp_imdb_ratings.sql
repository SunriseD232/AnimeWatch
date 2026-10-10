-- MediaWatch — миграция 0049: рейтинги Кинопоиска и IMDb в каталоге кино
-- Применить: docker cp … supabase-db:/tmp/ && docker exec -i supabase-db
-- psql -U postgres -d postgres -f /tmp/0049_cinema_kp_imdb_ratings.sql
--
-- ЗАЧЕМ. На карточке фильма стоял только рейтинг TMDB — зрителю в России
-- привычнее КП и IMDb (просьба владельца сайта, 2026-10-10).
--
-- ОТКУДА. rating.kinopoisk.ru/<kp_id>.xml — открытый адрес без ключа, отдаёт
-- сразу обе оценки с числом голосов: <kp_rating num_vote=…>9.111</kp_rating>
-- <imdb_rating num_vote=…>9.3</imdb_rating>. id Кинопоиска у каждого нашего
-- тайтла уже есть (cinema_index.kp_id). Один запрос на тайтл, поэтому — как
-- у рейтингов TMDB (0027): своя таблица, которая ПЕРЕЖИВАЕТ ночную
-- перестройку каталога, свой крон с потолком запросов за прогон, а в выдачу
-- оценки попадают следующей перестройкой (копируются в cinema_index).

create table if not exists cinema_ext_ratings (
  kp_id integer primary key,
  kp_rating numeric(4,2),
  kp_votes integer,
  imdb_rating numeric(3,1),
  imdb_votes integer,
  -- Когда проверяли. Ставится и тогда, когда оценок нет вовсе (новинка без
  -- голосов): иначе такой тайтл вечно считался бы непроверенным и съедал
  -- бюджет каждого прогона.
  checked_at timestamptz not null default now()
);

create index if not exists cinema_ext_ratings_checked_idx on cinema_ext_ratings (checked_at);

alter table cinema_index add column if not exists kp_rating numeric(4,2);
alter table cinema_index add column if not exists imdb_rating numeric(3,1);

-- Доступы — как у остальных таблиц каталога (0027/0040): данные публичные,
-- одинаковые для всех; пишет только крон под service_role.
alter table cinema_ext_ratings enable row level security;

drop policy if exists "anyone can read cinema ext ratings" on cinema_ext_ratings;
create policy "anyone can read cinema ext ratings" on cinema_ext_ratings for select using (true);

grant select on cinema_ext_ratings to authenticated, anon;
