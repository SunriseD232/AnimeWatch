-- Поиск с опечатками в разделах чтения (24.10.2026).
--
-- Манга, ранобэ и книги ищутся по словам через ilike (lib/indexSearch.ts):
-- «Фриерен» не находил «Фрирен», хотя тайтл есть и с Remanga, и с MangaLib.
-- Аниме и кино прощают опечатки триграммами (0034) — здесь то же самое, но
-- только запасным путём: код зовёт эти функции, когда точный поиск ничего не
-- нашёл, чтобы точные совпадения не тонули среди похожих.
--
-- word_similarity (<%) сравнивает запрос с самым похожим куском названия, а
-- не со всей строкой: длинное «Фрирен, провожающая в последний путь» иначе
-- проигрывало бы короткому. Порог 0.4 вместо стандартных 0.6: у «фриерен» и
-- «фрирен» сходство ровно 0.5 — одна лишняя буква в коротком слове съедает
-- половину триграмм. Ниже 0.4 начинается шум.
--
-- Индексы — уже существующие gin_trgm_ops по названиям (0054–0056):
-- оператор <% ими пользуется, запрос по манге ~5 мс, по 620 тыс. книг
-- ~170 мс.

create or replace function search_manga_fuzzy(q text, lim integer default 24, off integer default 0)
returns setof manga_index
language sql
stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  select m.*
  from manga_index m
  where m.in_catalog
    and (q <% m.title or q <% m.original_title or q <% m.alternative_title)
  order by
    greatest(
      word_similarity(q, m.title),
      coalesce(word_similarity(q, m.original_title), 0),
      coalesce(word_similarity(q, m.alternative_title), 0)
    ) desc,
    m.rank asc nulls last,
    m.views desc nulls last,
    m.title_id asc
  limit least(greatest(lim, 1), 60)
  offset greatest(off, 0);
$$;

create or replace function search_ranobe_fuzzy(q text, lim integer default 24, off integer default 0)
returns setof ranobe_index
language sql
stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  select r.*
  from ranobe_index r
  where r.in_catalog
    and (q <% r.title or q <% r.original_title or q <% r.alternative_title)
  order by
    greatest(
      word_similarity(q, r.title),
      coalesce(word_similarity(q, r.original_title), 0),
      coalesce(word_similarity(q, r.alternative_title), 0)
    ) desc,
    r.rank asc nulls last,
    r.views desc nulls last,
    r.title_id asc
  limit least(greatest(lim, 1), 60)
  offset greatest(off, 0);
$$;

create or replace function search_book_fuzzy(q text, lim integer default 24, off integer default 0)
returns setof book_index
language sql
stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  select b.*
  from book_index b
  where b.in_catalog
    and (q <% b.title or q <% b.author)
  order by
    greatest(word_similarity(q, b.title), coalesce(word_similarity(q, b.author), 0)) desc,
    b.rank asc nulls last,
    b.downloads desc nulls last,
    b.book_id desc
  limit least(greatest(lim, 1), 60)
  offset greatest(off, 0);
$$;

grant execute on function search_manga_fuzzy(text, integer, integer) to anon, authenticated, service_role;
grant execute on function search_ranobe_fuzzy(text, integer, integer) to anon, authenticated, service_role;
grant execute on function search_book_fuzzy(text, integer, integer) to anon, authenticated, service_role;
