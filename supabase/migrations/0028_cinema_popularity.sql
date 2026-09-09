-- MediaWatch — миграция 0028: популярность TMDB для каталога кино
--
-- ЗАЧЕМ. В каталоге кино не хватало сортировки «По популярности» — она есть
-- у аниме, и на главной под «Популярным» тоже что-то показывается. Но то,
-- что на главной названо «Популярное», на деле сортировка по РЕЙТИНГУ (см.
-- getPopularCinemaRanked в lib/videoseed-catalog.ts): своего рейтинга у
-- Videoseed нет вовсе, а популярности нет тем более.
--
-- Настоящая популярность есть у TMDB — поле popularity в тех же ответах
-- /find, которые мы и так запрашиваем ради рейтинга. То есть отдельных
-- запросов это не стоит НИ ОДНОГО: просто перестали выбрасывать поле.
--
-- Разница по смыслу: рейтинг — «насколько понравилось тем, кто посмотрел»,
-- популярность — «сколько людей смотрит прямо сейчас». Сортировки разные и
-- нужны обе.

alter table cinema_ratings add column if not exists popularity numeric(10,3);
alter table cinema_index add column if not exists popularity numeric(10,3);

-- Сортировка по популярности — такой же полноценный путь, как по рейтингу.
create index if not exists cinema_index_batch_popularity_idx
  on cinema_index (batch_id, popularity desc nulls last);

-- Сортировка «Сначала новые» переехала с даты добавления у Videoseed на год
-- выпуска: дата добавления показывала первыми фильмы 1986 и 1996 годов,
-- потому что она про то, когда запись завели у апстрима, а не когда вышло
-- кино. Год + дата добавления вторым ключом — это и есть «новинки».
create index if not exists cinema_index_batch_year_idx
  on cinema_index (batch_id, year desc nulls last, added_at desc nulls last);
