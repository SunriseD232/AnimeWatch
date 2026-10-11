-- MediaWatch — миграция 0050: оценки IMDb из официальной выгрузки IMDb
-- Применить: docker cp … supabase-db:/tmp/ && docker exec -i supabase-db
-- psql -U postgres -d postgres -f /tmp/0050_cinema_imdb_ratings.sql
--
-- ЗАЧЕМ. Оценку IMDb на карточке (0049) мы брали у Кинопоиска, и у 8 543
-- тайтлов с imdb_id её там не было. Официальная выгрузка IMDb
-- title.ratings.tsv.gz (8,6 МБ, обновляется ежедневно, без ключа) — первоисточник:
-- замерено 2026-10-11, она закрывает 4 937 из этих пропусков и даёт свежие
-- числа для остальных. Схема та же, что у жанров IMDb (0040): одна
-- долгоживущая таблица, свой крон, в выдачу — ближайшей перестройкой
-- каталога (она предпочитает эту оценку оценке из ответа Кинопоиска).

create table if not exists cinema_imdb_ratings (
  imdb_id text primary key,
  rating numeric(3,1) not null,
  votes integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table cinema_imdb_ratings enable row level security;

drop policy if exists "anyone can read cinema imdb ratings" on cinema_imdb_ratings;
create policy "anyone can read cinema imdb ratings" on cinema_imdb_ratings for select using (true);

grant select on cinema_imdb_ratings to authenticated, anon;
