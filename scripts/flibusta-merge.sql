-- Слияние дампа Флибусты в book_index (миграции 0054, 0060).
--
-- Запускает scripts/flibusta-import.sh: psql -U postgres -v ON_ERROR_STOP=1
-- -f flibusta-merge.sql. TSV готовит scripts/flibusta-dump.mjs и кладёт в
-- /tmp/flibusta внутри контейнера базы (пути ниже прописаны явно: \copy в
-- psql не подставляет переменные). Роль postgres — владелец book_index, как при
-- применении миграций.
--
-- Всё в одной транзакции: сайт видит либо старый каталог, либо новый,
-- никогда не половину. Ошибка или подозрительно маленький дамп — откат
-- целиком, каталог не тронут.

\set ON_ERROR_STOP on
begin;

create temp table f_book (book_id bigint, title text, lang text, ftype text, year int, fsize bigint) on commit drop;
create temp table f_avtor (book_id bigint, avtor_id bigint, pos int) on commit drop;
create temp table f_avtorname (avtor_id bigint, first_name text, middle_name text, last_name text, nick text) on commit drop;
create temp table f_genre (book_id bigint, genre_id int) on commit drop;
create temp table f_genrelist (genre_id int, descr text) on commit drop;
create temp table f_annot (book_id bigint, body text) on commit drop;

\copy f_book from '/tmp/flibusta/book.tsv'
\copy f_avtor from '/tmp/flibusta/avtor.tsv'
\copy f_avtorname from '/tmp/flibusta/avtorname.tsv'
\copy f_genre from '/tmp/flibusta/genre.tsv'
\copy f_genrelist from '/tmp/flibusta/genrelist.tsv'
\copy f_annot from '/tmp/flibusta/annot.tsv'

-- Дамп оборван или Флибуста отдала заглушку — каталог не трогаем. 2026-10:
-- ~620 тыс. книг FB2/EPUB, порог с большим запасом.
do $$
declare n bigint;
begin
  select count(*) into n from f_book;
  if n < 300000 then
    raise exception 'в дампе всего % книг — импорт отменён, каталог не тронут', n;
  end if;
end $$;

create index on f_book (book_id);
analyze f_book;

-- Авторы в порядке, заданном Флибустой: «Имя Отчество Фамилия», а если
-- имени нет — псевдоним.
create temp table f_authors on commit drop as
select a.book_id,
       string_agg(
         coalesce(nullif(btrim(concat_ws(' ', nullif(n.first_name, ''), nullif(n.middle_name, ''), nullif(n.last_name, ''))), ''),
                  nullif(n.nick, '')),
         ', ' order by a.pos, a.avtor_id) as author
  from f_avtor a
  join f_avtorname n using (avtor_id)
 group by a.book_id;

create temp table f_genres on commit drop as
select g.book_id, array_agg(distinct l.descr order by l.descr) as genres
  from f_genre g
  join f_genrelist l using (genre_id)
 where l.descr is not null
 group by g.book_id;

create temp table f_annots on commit drop as
select distinct on (book_id) book_id, body from f_annot order by book_id;

create index on f_authors (book_id);
create index on f_genres (book_id);
create index on f_annots (book_id);

-- Upsert. У книг из ночной витрины OPDS сохраняем то, чего в дампе нет:
-- обложку, число скачиваний и место в витрине (rank). Аннотацию и автора из
-- дампа берём, только если они есть.
insert into book_index (
  book_id, title, author, annotation, genres, language, formats,
  size_bytes, year, source_url, in_catalog, updated_at
)
select b.book_id,
       b.title,
       au.author,
       an.body,
       coalesce(ge.genres, '{}'),
       b.lang,
       -- FB2 Флибуста конвертирует в EPUB на лету, поэтому у FB2 оба
       -- формата (так же их отдаёт OPDS).
       case when b.ftype = 'fb2' then array['fb2', 'epub'] else array['epub'] end,
       b.fsize,
       b.year,
       'https://flibusta.is/b/' || b.book_id,
       true,
       now()
  from f_book b
  left join f_authors au using (book_id)
  left join f_genres ge using (book_id)
  left join f_annots an using (book_id)
on conflict (book_id) do update set
  title = excluded.title,
  author = coalesce(excluded.author, book_index.author),
  annotation = coalesce(excluded.annotation, book_index.annotation),
  genres = case when cardinality(excluded.genres) > 0 then excluded.genres else book_index.genres end,
  language = coalesce(excluded.language, book_index.language),
  formats = excluded.formats,
  size_bytes = coalesce(excluded.size_bytes, book_index.size_bytes),
  year = coalesce(excluded.year, book_index.year),
  in_catalog = true,
  updated_at = now();

-- Книги, которых в дампе больше нет (удалены или стали PDF/DjVu), уходят из
-- каталога. Строки остаются — ради карточек, «Продолжить» и сохранённых на
-- сервере книг. Сегодняшнюю витрину OPDS (rank) не трогаем: она могла
-- поймать новинку свежее дампа.
update book_index
   set in_catalog = false
 where in_catalog
   and rank is null
   and not exists (select 1 from f_book f where f.book_id = book_index.book_id);

update book_index_state
   set dump_imported_at = now(),
       dump_books = (select count(*) from f_book),
       dump_error = null
 where id;

commit;

select 'книг в каталоге: ' || count(*) from book_index where in_catalog;
