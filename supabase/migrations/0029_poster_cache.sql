-- MediaWatch — миграция 0029: локальный кэш постеров
--
-- ЗАЧЕМ. Обложки сейчас грузятся из четырёх разных чужих мест, и каждое —
-- отдельная точка отказа и отдельная задержка:
--   * аниме в каталоге — shikimori.io (в среднем 144 КБ на постер);
--   * аниме на главной — yani.tv, туда подменяются обложки там, где у
--     Shikimori плейсхолдер (см. withYummyPosters в lib/shikimori.ts);
--   * кино — api.videoseed.tv, и не напрямую, а через НАШ прокси
--     /api/proxy/raw, который на КАЖДЫЙ запрос заново качает картинку с
--     Videoseed и заново жмёт её в WebP через sharp. Дискового кэша там нет.
--
-- Замерено на боевом сервере: постер аниме — 144 КБ оригинал, 47 КБ после
-- сжатия в WebP шириной 480; постер кино — 48 КБ оригинал, 18 КБ после.
-- Весь каталог целиком: ~1,1 ГБ аниме (23,9 тыс.) + ~1,7 ГБ кино (93,5 тыс.)
-- = около 2,8 ГБ при 59 ГБ свободных на диске.
--
-- Файлы лежат на диске (POSTER_DIR, по папке на раздел), а эта таблица —
-- реестр: что скачано, откуда и когда. Она НЕ партионная и переживает
-- ночную перестройку индекса, как и cinema_ratings: перекачивать 117 тысяч
-- картинок каждую ночь незачем, меняются единицы.

create table if not exists poster_cache (
  -- 'anime' | 'cinema' — они же имена подпапок в POSTER_DIR.
  kind text not null,
  -- shikimori_id для аниме, kinopoisk_id для кино.
  source_id integer not null,
  -- Откуда скачали. Нужен, чтобы заметить смену обложки у апстрима: URL
  -- содержит хеш файла, поэтому изменился URL — изменилась и картинка.
  source_url text,
  bytes integer,
  width integer,
  height integer,
  fetched_at timestamptz not null default now(),
  -- Сколько раз подряд не удалось скачать. Растёт — пробуем всё реже, чтобы
  -- несколько тысяч битых ссылок не съедали бюджет каждого прогона.
  miss_count integer not null default 0,
  primary key (kind, source_id)
);

-- Прогон выбирает «самые несвежие сначала» — индекс ровно под это.
create index if not exists poster_cache_fetched_idx
  on poster_cache (kind, fetched_at asc nulls first);

-- Денормализованный флаг в самих индексах: страница каталога должна решить,
-- какую ссылку отдать, ОДНИМ запросом, без join'а по 24 карточкам.
-- Проставляется скачивателем сразу и заново копируется при перестройке.
alter table anime_index add column if not exists poster_local boolean not null default false;
alter table cinema_index add column if not exists poster_local boolean not null default false;

alter table poster_cache enable row level security;
create policy "anyone can read poster cache" on poster_cache for select using (true);
grant select on poster_cache to authenticated, anon;
