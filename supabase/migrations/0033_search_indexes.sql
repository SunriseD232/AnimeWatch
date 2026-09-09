-- MediaWatch — миграция 0033: поиск по локальному индексу
--
-- ЗАЧЕМ. Поиск и подсказки ходили в чужие API: аниме — в Shikimori, кино — в
-- Videoseed (там ещё и квота). Отсюда задержка в сотни миллисекунд на каждое
-- нажатие клавиши, зависимость от доступности апстрима и полное отсутствие
-- устойчивости к опечаткам: оба ищут подстрокой.
--
-- Каталог уже лежит у нас целиком — 23 915 аниме и 93 529 фильмов и
-- сериалов. Триграммный индекс превращает поиск в локальный запрос с
-- ранжированием по похожести: «наруто» находит «Наруто», «наруто ураганные
-- хроники» и переживает «нарута».
--
-- pg_trgm — стандартное расширение Postgres, в образе Supabase оно есть.

create extension if not exists pg_trgm;

-- Поле для поиска: русское и оригинальное названия в одной строке. Отдельной
-- колонкой, а не выражением в индексе, чтобы по нему же можно было
-- ранжировать в SELECT без повторного склеивания.
alter table anime_index
  add column if not exists search_text text
  generated always as (
    lower(coalesce(russian, '') || ' ' || coalesce(name, ''))
  ) stored;

alter table cinema_index
  add column if not exists search_text text
  generated always as (
    lower(coalesce(title, '') || ' ' || coalesce(original_title, ''))
  ) stored;

-- GIN + gin_trgm_ops: и по similarity(), и по ILIKE '%...%' — один индекс
-- обслуживает оба случая.
create index if not exists anime_index_search_trgm_idx
  on anime_index using gin (search_text gin_trgm_ops);

create index if not exists cinema_index_search_trgm_idx
  on cinema_index using gin (search_text gin_trgm_ops);

-- Порог похожести по умолчанию (0.3) для наших запросов высоковат: «наруто»
-- против «наруто: ураганные хроники» даёт около 0.28 и выпадает. Ставим
-- 0.15 на уровне базы — это влияет только на оператор %, которым мы и ищем.
alter database postgres set pg_trgm.similarity_threshold = 0.15;
