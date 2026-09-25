-- MediaWatch — миграция 0043: backdrop_path TMDB для hero кино
--
-- TMDB find/{imdbId} (уже вызывается еженедельно в lib/cinemaRatings.ts ради
-- рейтинга) отдаёт backdrop_path в том же ответе — отдельного похода в TMDB
-- не требуется, только читаем ещё одно поле из уже идущего запроса.
--
-- cinema_ratings — источник (переживает ночную перестройку индекса, как и
-- rating/popularity), cinema_index — копия для конкретной активной партии,
-- проставляется при сборке (см. loadRatings в lib/cinemaIndex.ts), как и
-- остальные поля из cinema_ratings.
alter table cinema_ratings add column if not exists backdrop_path text;
alter table cinema_index add column if not exists backdrop_path text;
