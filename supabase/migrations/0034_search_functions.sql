-- MediaWatch — миграция 0034: ранжирование поиска
--
-- Одной похожести мало: по ней «Властелин быта» (0.476) обходит «Властелин
-- колец» (0.471) — триграммы не знают, что второе слово запроса важное.
-- Нужен составной порядок, а PostgREST умеет сортировать только по колонкам,
-- поэтому логика живёт функцией в базе и вызывается через rpc().
--
-- Порядок ранжирования, от сильного к слабому:
--   1. точное совпадение названия целиком;
--   2. название НАЧИНАЕТСЯ с запроса («наруто» → «Наруто: Ураганные хроники»
--      важнее, чем «Путь Наруто»);
--   3. запрос встречается подстрокой;
--   4. похожесть по триграммам — она и вытягивает опечатки;
--   5. при прочих равных — популярность (у кино) или оценка (у аниме),
--      чтобы из десятка одинаково подходящих первым шёл известный тайтл.

create or replace function search_anime_index(q text, lim integer default 20)
returns table (
  shikimori_id integer,
  name text,
  russian text,
  kind text,
  status text,
  episodes integer,
  episodes_aired integer,
  aired_on date,
  released_on date,
  score numeric,
  poster_original text,
  poster_preview text,
  description text,
  poster_local boolean
)
language sql
stable
as $$
  select i.shikimori_id, i.name, i.russian, i.kind, i.status, i.episodes,
         i.episodes_aired, i.aired_on, i.released_on, i.score,
         i.poster_original, i.poster_preview, i.description, i.poster_local
  from anime_index i
  where i.batch_id = (select active_batch from anime_index_state where id)
    and (i.search_text % lower(q) or i.search_text like '%' || lower(q) || '%')
  order by
    (lower(coalesce(i.russian, i.name, '')) = lower(q)) desc,
    (i.search_text like lower(q) || '%') desc,
    (i.search_text like '%' || lower(q) || '%') desc,
    similarity(i.search_text, lower(q)) desc,
    i.score desc nulls last,
    i.shikimori_id
  limit least(greatest(lim, 1), 50);
$$;

create or replace function search_cinema_index(q text, lim integer default 20)
returns table (
  kp_id integer,
  title text,
  original_title text,
  kind text,
  is_serial boolean,
  year integer,
  poster text,
  rating numeric,
  poster_local boolean,
  description text
)
language sql
stable
as $$
  select i.kp_id, i.title, i.original_title, i.kind, i.is_serial, i.year,
         i.poster, i.rating, i.poster_local, i.description
  from cinema_index i
  where i.batch_id = (select active_batch from cinema_index_state where id)
    and (i.search_text % lower(q) or i.search_text like '%' || lower(q) || '%')
  order by
    (lower(coalesce(i.title, '')) = lower(q)) desc,
    (i.search_text like lower(q) || '%') desc,
    (i.search_text like '%' || lower(q) || '%') desc,
    similarity(i.search_text, lower(q)) desc,
    i.popularity desc nulls last,
    i.kp_id
  limit least(greatest(lim, 1), 50);
$$;

grant execute on function search_anime_index(text, integer) to authenticated, anon;
grant execute on function search_cinema_index(text, integer) to authenticated, anon;
