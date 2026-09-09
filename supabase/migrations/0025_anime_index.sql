-- MediaWatch — миграция 0025: локальный индекс каталога аниме
-- Применить через Supabase SQL Editor.
--
-- ЗАЧЕМ. Каталог фильтровал через Shikimori, и это упиралось в три стены:
--   1. Список жанров брался из легаси-эндпоинта REST /genres (46 записей).
--      В актуальной таксономии их 80 (22 жанра, 53 темы, 5 демографий), а
--      «Магия» (id 16) не существует вовсе — MAL растворил её во «Фэнтези»
--      и «Махо-сёдзё». Кнопка была, результатов не было.
--   2. Жанров нет в списочном ответе REST, поэтому AND и исключение по
--      нескольким жанрам шли «медленным путём»: догрузка полных карточек по
--      одной с потолком в 120 штук. Редкие комбинации отдавали мало
--      результатов не потому, что их нет, а потому что кончался бюджет.
--   3. Числа серий у Shikimori в API v1 вообще нет как фильтра.
-- Всё это решается одним локальным индексом: 24 тысячи тайтлов со всеми
-- нужными полями — это ~11 МБ, а фильтрация становится одним SQL-запросом.
--
-- КАК ОБНОВЛЯЕТСЯ. Полной перезакачкой с нуля (см. lib/animeIndex.ts), но
-- НЕ через TRUNCATE живой таблицы: если закачка оборвётся на середине,
-- каталог останется пустым. Вместо этого каждая закачка пишет строки со
-- своим batch_id, и только после того, как она целиком удалась и прошла
-- проверку на вменяемость, указатель в anime_index_state переключается на
-- новую партию. Старая удаляется уже после. Читатели в любой момент видят
-- целую партию — либо старую, либо новую, промежуточного состояния нет.
--
-- Переключение — это UPDATE одной строки, поэтому обходится без хранимых
-- функций и работает через обычный PostgREST, которым ходит приложение.

-- ─────────────────────────────────────────────────────────────
-- Таксономия: жанры, темы и демографии
-- ─────────────────────────────────────────────────────────────
create table if not exists anime_genres (
  -- id из актуальной таксономии Shikimori (GraphQL), НЕ из легаси /genres:
  -- они расходятся, например «Триллер» там 41, здесь 117.
  id integer primary key,
  name text not null,
  russian text not null,
  -- 'genre' | 'theme' | 'demographic' — разные разделы в панели фильтров
  kind text not null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Сам индекс тайтлов
-- ─────────────────────────────────────────────────────────────
create table if not exists anime_index (
  batch_id uuid not null,
  shikimori_id integer not null,

  name text,
  russian text,
  kind text,
  status text,
  rating text,

  episodes integer not null default 0,
  episodes_aired integer not null default 0,
  -- Число серий для ФИЛЬТРА, считается при записи (см. lib/animeIndex.ts).
  -- У онгоингов episodes часто 0 («сколько будет всего — неизвестно»), а
  -- episodes_aired уже осмысленно; ноль здесь означает именно «неизвестно»
  -- и такие тайтлы не попадают в выдачу при заданном диапазоне. Отдельной
  -- колонкой, потому что выражением через coalesce/case это не проиндексиро-
  -- вать без функционального индекса, а фильтр по нему — один из основных.
  episodes_effective integer not null default 0,

  aired_on date,
  released_on date,
  -- Год выносим отдельной колонкой: фильтр по диапазону лет — самый частый,
  -- а по date пришлось бы либо считать extract() на каждой строке, либо
  -- заводить функциональный индекс.
  aired_year integer,

  score numeric(4,2),
  -- Позиция в сортировке по популярности. Отдельной колонкой, потому что
  -- GraphQL Shikimori умеет СОРТИРОВАТЬ по популярности (order: popularity),
  -- но самого поля не отдаёт — ни popularity, ни userRatesStats на типе
  -- Anime нет. Ранг снимается вторым, лёгким проходом (только id), иначе
  -- сортировку «По популярности» в каталоге пришлось бы просто выкинуть.
  -- null — ранг снять не удалось, такие тайтлы уходят в конец.
  popularity_rank integer,
  poster_original text,
  poster_preview text,

  -- Массив, а не таблица связей: семантика фильтра ровно совпадает с
  -- операторами Postgres — AND по жанрам это `@> ARRAY[...]`, исключение
  -- `not (genre_ids && ARRAY[...])`, и оба покрываются одним GIN-индексом.
  -- Отдельная таблица связей потребовала бы группировки с having count(*),
  -- то есть больше кода и медленнее на тех же данных.
  genre_ids integer[] not null default '{}',

  primary key (batch_id, shikimori_id)
);

-- Все запросы каталога начинаются с фильтра по активной партии, поэтому
-- batch_id — первым полем во всех составных индексах.
create index if not exists anime_index_genres_idx
  on anime_index using gin (genre_ids);

create index if not exists anime_index_batch_aired_idx
  on anime_index (batch_id, aired_on desc nulls last);

create index if not exists anime_index_batch_score_idx
  on anime_index (batch_id, score desc nulls last);

create index if not exists anime_index_batch_name_idx
  on anime_index (batch_id, russian);

create index if not exists anime_index_batch_popularity_idx
  on anime_index (batch_id, popularity_rank nulls last);

create index if not exists anime_index_batch_filters_idx
  on anime_index (batch_id, kind, status, aired_year, episodes_effective);

-- ─────────────────────────────────────────────────────────────
-- Указатель на активную партию
-- ─────────────────────────────────────────────────────────────
-- Ровно одна строка: id — константа true с проверкой, это стандартный приём
-- «таблица-синглтон», он не даёт случайно завести вторую конфигурацию.
create table if not exists anime_index_state (
  id boolean primary key default true check (id),
  active_batch uuid,
  built_at timestamptz,
  titles_count integer not null default 0,
  -- Для диагностики: сколько партия шла и чем закончилась прошлая попытка.
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into anime_index_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Доступы
-- ─────────────────────────────────────────────────────────────
-- Индекс — публичные данные каталога, одинаковые для всех: построчной
-- защиты тут нет и не нужно, RLS включаем только чтобы политика чтения была
-- явной, а не «таблица открыта, потому что про неё забыли».
alter table anime_genres enable row level security;
alter table anime_index enable row level security;
alter table anime_index_state enable row level security;

create policy "anyone can read genres" on anime_genres for select using (true);
create policy "anyone can read index" on anime_index for select using (true);
create policy "anyone can read index state" on anime_index_state for select using (true);

-- Явный грант — RLS policy без него не работает (Postgres сначала проверяет
-- табличные права, потом RLS). Та же грабля, что в 0020/0021/0024.
grant select on anime_genres to authenticated, anon;
grant select on anime_index to authenticated, anon;
grant select on anime_index_state to authenticated, anon;

-- Пишет только крон переиндексации, он ходит под service_role (обходит RLS).
-- Права service_role на новые таблицы уже покрыты default privileges из 0014.
