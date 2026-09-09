-- MediaWatch — миграция 0027: локальный индекс каталога кино
--
-- ЗАЧЕМ. Раздел «Фильмы и сериалы» фильтровал через Videoseed, а тот НЕ
-- УМЕЕТ фильтровать и сортировать вообще: проверено вживую — параметры
-- year=, genre_id=, sort_by= он молча игнорирует, total не меняется, порядок
-- выдачи тот же. Поэтому каталог на каждый клик тянул до 30 апстрим-страниц
-- по 50 записей, отбирал их подстрокой по строке жанров
-- (genre.includes('Драма')) и сортировал пул из 120 записей. Ни года, ни
-- страны, ни рейтинга по всей базе, ни честной пагинации так не сделать —
-- и вдобавок это жгло квоту их API на пользовательском трафике.
--
-- Локальный индекс решает всё сразу: 103 тысячи тайтлов (82 455 фильмов +
-- 20 969 сериалов) выкачиваются за 207 запросов по 500 записей, а фильтр
-- становится одним SQL-запросом.
--
-- КАК ОБНОВЛЯЕТСЯ. Та же схема, что у аниме (миграция 0025): полная
-- перезакачка с нуля, но живая таблица не опустошается ни на секунду —
-- строки пишутся со своим batch_id, и указатель в cinema_index_state
-- переключается только после того, как закачка целиком удалась и прошла
-- проверку на вменяемость. Оборвалась — читатели видят прошлую партию.
--
-- Рейтинги живут ОТДЕЛЬНО и перестройку переживают (см. cinema_ratings).

-- ─────────────────────────────────────────────────────────────
-- Справочники: жанры и страны
-- ─────────────────────────────────────────────────────────────
-- Строятся из самих данных: Videoseed отдаёт параллельно genre_ids/genre и
-- country_ids/country.
--
-- ВНИМАНИЕ, ловушка: сопоставлять id и название ПО ПОЗИЦИИ в строке нельзя.
-- Названия приходят по алфавиту, id — по возрастанию, и это расходится
-- (Вестерн=4 стоит раньше Военный=3; Мультсериалы=22 раньше Сериалы=20).
-- Словарь выводится пересечением множеств по всем записям — см.
-- lib/cinemaIndex.ts.
create table if not exists cinema_genres (
  id integer primary key,
  name text not null,
  -- 'genre' — настоящий жанр, показывается в фильтре;
  -- 'type'  — маркер типа контента (Сериалы=20, Мультфильмы=21,
  --           Мультсериалы=22, Короткометражки=7569). В списке жанров им не
  --           место: они дублируют переключатель типа. Но из genre_ids их не
  --           выкидываем — именно по ним и вычисляется kind.
  kind text not null default 'genre',
  updated_at timestamptz not null default now()
);

create table if not exists cinema_countries (
  id integer primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Сам индекс
-- ─────────────────────────────────────────────────────────────
create table if not exists cinema_index (
  batch_id uuid not null,
  -- kinopoisk_id. Именно он — внешний id раздела кино: по нему открывается
  -- плеер и он же пишется в watch_progress.shikimori_id при
  -- content_type='cinema' (см. lib/videoseed-catalog.ts). Записи без него
  -- в индекс не попадают — по ним не построить ни плеер, ни прогресс.
  kp_id integer not null,
  -- Внутренний id Videoseed. Не ключ (у разных записей может совпасть
  -- kinopoisk_id), но полезен для диагностики расхождений с апстримом.
  vs_id integer,

  title text,
  original_title text,

  -- 'movie' | 'serial' | 'cartoon' | 'cartoon_serial' | 'short'.
  -- Вычисляется при записи из type + жанров-маркеров, см. lib/cinemaIndex.ts:
  -- у Videoseed своего поля с такой детализацией нет, там только movie/serial.
  kind text not null default 'movie',
  is_serial boolean not null default false,

  -- Год отдельной колонкой (а не выражением по дате): фильтр по диапазону
  -- лет — один из основных, а 0 у Videoseed означает «год неизвестен» и
  -- пишется сюда как null.
  year integer,

  poster text,
  description text,
  -- Длительность в минутах. Только у фильмов: у сериалов поля time нет
  -- вовсе (проверено на выборке в 2500 записей — 0% заполнения).
  duration_min integer,

  imdb_id text,
  tmdb_id integer,

  -- Когда запись появилась у Videoseed. Единственная осмысленная «дата
  -- добавления»: настоящей даты премьеры апстрим не отдаёт, только год.
  added_at timestamptz,
  -- Дата последнего добавленного видео. Только у сериалов, заполнена у 100%
  -- из них. Это и «сортировка по дате последней серии», и фактический
  -- признак живого сериала.
  last_episode_at timestamptz,

  -- Озвучка по умолчанию (только фильмы). Хранится строкой как есть:
  -- значений 423 штуки, группировать их в классы — задача UI, а не индекса.
  translation text,

  -- Массивы, а не таблицы связей: семантика фильтра ровно совпадает с
  -- операторами Postgres — AND это `@> ARRAY[...]`, исключение
  -- `not (genre_ids && ARRAY[...])`, и оба покрываются одним GIN-индексом.
  genre_ids integer[] not null default '{}',
  country_ids integer[] not null default '{}',

  -- Денормализованный рейтинг TMDB: копируется из cinema_ratings в момент
  -- сборки партии. Отдельной колонкой, потому что по нему сортируют, а
  -- сортировка по присоединённой таблице через PostgREST не выражается.
  -- Свежий рейтинг доезжает до выдачи следующей ночью — недельный джоб
  -- пишет только cinema_ratings.
  rating numeric(4,2),

  primary key (batch_id, kp_id)
);

-- Все запросы каталога начинаются с фильтра по активной партии, поэтому
-- batch_id — первым полем во всех составных индексах.
create index if not exists cinema_index_genres_idx
  on cinema_index using gin (genre_ids);

create index if not exists cinema_index_countries_idx
  on cinema_index using gin (country_ids);

create index if not exists cinema_index_batch_added_idx
  on cinema_index (batch_id, added_at desc nulls last);

create index if not exists cinema_index_batch_last_ep_idx
  on cinema_index (batch_id, last_episode_at desc nulls last);

create index if not exists cinema_index_batch_rating_idx
  on cinema_index (batch_id, rating desc nulls last);

create index if not exists cinema_index_batch_title_idx
  on cinema_index (batch_id, title);

create index if not exists cinema_index_batch_filters_idx
  on cinema_index (batch_id, kind, year);

-- ─────────────────────────────────────────────────────────────
-- Рейтинги TMDB — ЖИВУТ МЕЖДУ ПЕРЕСТРОЙКАМИ
-- ─────────────────────────────────────────────────────────────
-- Отдельная таблица именно потому, что она НЕ партионная. TMDB не отдаёт
-- рейтинги пачкой: один запрос на тайтл, то есть 103 тысячи запросов на
-- полный обход, да ещё через VLESS-туннель (api.themoviedb.org с этой VPS
-- заблокирован по DNS, см. lib/tmdb.ts). Складывать это в ночную
-- перестройку нельзя — она из семиминутной стала бы трёхчасовой.
--
-- Ключ — imdb_id: он есть у 100% записей Videoseed и, в отличие от kp_id,
-- переживает переезды тайтла между записями апстрима.
create table if not exists cinema_ratings (
  imdb_id text primary key,
  rating numeric(4,2),
  votes integer,
  tmdb_id integer,
  -- 'movie' | 'tv' — что именно нашлось у TMDB по этому imdb_id.
  media_type text,
  -- Когда ходили в TMDB. По нему недельный джоб выбирает, что обновлять, и
  -- он же не даёт бесконечно долбиться в тайтлы, которых у TMDB нет:
  -- отметка ставится и при неудачном поиске, с rating = null.
  checked_at timestamptz not null default now(),
  -- Сколько раз подряд не удалось получить рейтинг. Растёт — тайтл
  -- проверяется всё реже (см. lib/cinemaRatings.ts).
  miss_count integer not null default 0
);

-- Недельный джоб выбирает «самые несвежие сначала» — индекс ровно под это.
create index if not exists cinema_ratings_checked_idx
  on cinema_ratings (checked_at asc nulls first);

-- ─────────────────────────────────────────────────────────────
-- Указатель на активную партию
-- ─────────────────────────────────────────────────────────────
create table if not exists cinema_index_state (
  id boolean primary key default true check (id),
  active_batch uuid,
  built_at timestamptz,
  titles_count integer not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text,
  -- Отдельно про рейтинги: у них свой график (раз в неделю), и путать их
  -- исход с исходом перестройки каталога нельзя — иначе неудача одного
  -- маскирует другое.
  ratings_run_started_at timestamptz,
  ratings_run_finished_at timestamptz,
  ratings_checked integer not null default 0,
  ratings_error text
);

insert into cinema_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
-- Индекс — публичные данные каталога, одинаковые для всех: построчной
-- защиты тут нет и не нужно, RLS включаем только чтобы политика чтения была
-- явной, а не «таблица открыта, потому что про неё забыли».
alter table cinema_genres enable row level security;
alter table cinema_countries enable row level security;
alter table cinema_index enable row level security;
alter table cinema_index_state enable row level security;
alter table cinema_ratings enable row level security;

create policy "anyone can read cinema genres" on cinema_genres for select using (true);
create policy "anyone can read cinema countries" on cinema_countries for select using (true);
create policy "anyone can read cinema index" on cinema_index for select using (true);
create policy "anyone can read cinema index state" on cinema_index_state for select using (true);
create policy "anyone can read cinema ratings" on cinema_ratings for select using (true);

-- Явный грант — RLS policy без него не работает (Postgres сначала проверяет
-- табличные права, потом RLS). Та же грабля, что в 0020/0021/0024/0025.
grant select on cinema_genres to authenticated, anon;
grant select on cinema_countries to authenticated, anon;
grant select on cinema_index to authenticated, anon;
grant select on cinema_index_state to authenticated, anon;
grant select on cinema_ratings to authenticated, anon;

-- Пишут только кроны, они ходят под service_role (обходит RLS).
-- Права service_role на новые таблицы уже покрыты default privileges из 0014.
