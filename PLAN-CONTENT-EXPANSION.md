# MediaWatch — расширение: книги, манга, ранобэ, подкасты

Черновик технического плана. Все факты об источниках проверены живыми
запросами 22–23.10.2026. Оценки сроков — ориентировочные, не обязательства.

---

## 1. Что уже есть и что это даёт

Сайт уже построен вокруг четырёх универсальных идей, которые новые разделы
переиспользуют почти без изменений:

| Существующее | Как переиспользуется |
|---|---|
| `ContentType = 'anime' \| 'cinema'` | расширяется до `'book' \| 'manga' \| 'ranobe' \| 'podcast'` |
| `watch_progress` (позиция + «продолжить») | подкасты — почти как есть; книги/манга — через новые поля |
| `user_list` (плюс/просмотрено/брошено) | работает для всех типов, меняется только constraint |
| `watched_episodes` («просмотрено» по сериям/главам) | главы манги/ранобэ, эпизоды подкастов |
| `api_response_cache` (0019) | кэш Shikimori / MangaDex / OPDS / iTunes / RSS |
| `resolved_streams` + `/api/proxy/raw` (подпись URL) | шаблон для проксирования картинок манги |
| `useProgressSaver` | подкасты — напрямую; чтение — свой лёгкий аналог |
| `GenreFilterPanel`, `Pagination`, `PosterImage` | переиспользуются с новыми наборами жанров |
| `title_ratings`, `episode_comments`, `friendships` | ключуются по `content_type + shikimori_id` — расширяются constraint’ом |

Ключевой вывод: **новые разделы не требуют второй архитектуры.** Это те же
«тайтл → юнит (серия/глава/эпизод) → позиция внутри юнита», просто юнит
называется по-разному.

---

## 2. Проверенные источники (факты, не предположения)

### 2.1. Манга и ранобэ — Shikimori

Домен API в коде уже актуальный: `https://shikimori.io` (`src/lib/shikimori.ts`).
Штатный REST v1 жив, помечен как deprecated, публичный GET без авторизации.

- `GET /api/mangas` — каталог манги. Работает: `page, limit≤50, order, kind,
  status, season, score, genre, publisher, search, ids, exclude_ids, censored`.
  `kind`: `manga, manhwa, manhua, light_novel, novel, one_shot, doujin`.
- `GET /api/ranobe` — каталог ранобэ, **в единственном числе** (`/api/ranobes`
  → 404). Набор параметров тот же.
- **ID**: аниме и манга — разные пространства; **манга и ранобэ — одно**
  (ранобэ `id=89770` доступно и через `/api/mangas/89770`, и через
  `/api/ranobe/89770`).
- Список отдаёт `id, name, russian, image{original,preview,x96,x48}, kind,
  score, status, volumes, chapters, aired_on, released_on`, но **без жанров и
  описания** — они только в полной карточке `/api/mangas/{id}`. Это та же
  проблема, что уже решена для аниме в `getAnimeCatalog` (догрузка карточек
  через `mapWithConcurrency`).
- **Списка глав в API нет вообще** — только `chapters`/`volumes` числом.
  Главы берём у источника чтения.
- Обложки: `https://shikimori.io` + относительный путь из `image.*`.
- Лимиты: **5 запросов/сек, 90/мин**; в `User-Agent` желательно имя
  приложения. Заголовков `X-RateLimit-*` нет.
- Полная карточка содержит `myanimelist_id` — это ключ для маппинга на
  MangaDex (`links.mal`).

### 2.2. Чтение манги — MangaDex (официальный API)

- `GET https://api.mangadex.org/manga?availableTranslatedLanguage[]=ru&
  order[followedCount]=desc&includes[]=cover_art` — работает, у популярных
  тайтлов есть русские переводы (всего по API **103 254 русских главы** на
  момент проверки).
- `GET /manga?ids[]=...&includes[]=cover_art` — метаданные.
- `GET /chapter?manga={uuid}&translatedLanguage[]=ru&order[chapter]=asc` —
  список глав. У главы: `id, chapter, volume, title, pages, translatedLanguage,
  externalUrl, isUnavailable, readableAt`.
- `GET /at-home/server/{chapterId}` — реальные страницы:
  ```
  baseUrl: https://cmdxd98sb0x3yprd.mangadex.network
  chapter: { hash, data: ["1-....png", ...], dataSaver: ["1-....jpg", ...] }
  ```
  URL страницы: `{baseUrl}/data/{hash}/{file}` (или `/data-saver/`).
  Проверено на живой главе.
- Маппинг Shikimori → MangaDex: `shikimori.myanimelist_id` → `manga.links.mal`.
- Ограничения: у MangaDex есть rate limit (порядка 5 rps) и просьба сообщать
  об использованных страницах; часть глав `externalUrl` (на других сайтах) —
  такие читать у MangaDex нельзя.
- Картинки отдаются обычным `<img>`; CORS для картинок не нужен, но для
  скрытия источника и обхода возможных Referer-ограничений лучше свой
  подписанный прокси (как `/api/proxy/raw`).

### 2.3. Чтение манги — ReManga (русский каталог + страницы)

Публичный API мобильного приложения, без ключа (проверено):

- `GET https://api.remanga.org/api/search/?query=...&count=...` — поиск.
- `GET /api/titles/{dir}/` — карточка: `description, genres, categories,
  type, status, count_chapters, branches[]`.
- `GET /api/titles/chapters/?branch_id={id}&count=&page=` — главы:
  `id, tome, chapter, name, is_paid, price, purchase_type, index`.
- `GET /api/titles/chapters/{chapterId}/` — **страницы**:
  `pages: [[{link, width, height}, ...], ...]` — прямые `img3.reimg2.org`.
- Есть **платные главы** (`is_paid`, `price`, `is_bought`) — без аккаунта
  ReManga их не открыть; показываем замок и ссылку на источник.
- Часть тайтлов `is_forbidden_by_country` — учитывать при выдаче.
- Ограничение: API неофициальный, может измениться; нужен кэш и graceful
  degradation. Часть картинок может требовать Referer — прокси решает.

### 2.4. Чтение ранобэ — Renovels (+ Flibusta)

- `GET https://api.renovels.org/api/search/catalog?query=...` — каталог
  ранобэ (≈98 000 тайтлов, русские названия). Поля: `id, dir, main_name,
  rus_name, cover, genres, categories, avg_rating, is_forbidden`.
- `GET /api/titles/{dir}/` — карточка + `branches[]` (переводчики) +
  `count_chapters`.
- `GET /api/titles/chapters/?branch_id={id}&count=&page=` — главы работают.
- `GET /api/titles/chapters/{chapterId}/` (контент главы) — **500 без
  авторизации**: публичного доступа к тексту нет. Варианты: интеграция
  аккаунта Renovels (если у них есть API-токен), парсинг веб-читалки (хрупко)
  либо «читать на источнике» ссылкой.
- **Сильный обходной путь:** многие ранобэ (в т.ч. официальные переводы)
  лежат на Флибусте как fb2/epub. Тогда ранобэ читаются тем же ридером, что и
  книги (см. 2.5), а Shikimori/Renovels дают красивые метаданные и главы.

### 2.5. Книги — Флибуста (OPDS)

Проверено вживую (анонимно, без Cloudflare):

- OPDS: `https://flibusta.is/opds` → Atom XML, 200. Зеркало:
  `https://flibusta.site/opds` (тоже 200). `flibusta.appspot.com` мёртв,
  `flibusta.net` — битый TLS.
- Поиск книг:
  `GET https://flibusta.is/opds/search?searchType=books&searchTerm={q}`
  + `&pageNumber=N` (0-основанная пагинация). Формат — Atom.
- Запись книги содержит:
  ```
  /b/{id}/fb2   (application/fb2+zip)
  /b/{id}/epub  (application/epub+zip)   ← конвертация на лету
  /b/{id}/html, /txt, /rtf, /mobi
  /b/{id}/download  (оригинал pdf/djvu/doc для не-fb2 книг)
  ```
- Скачивание: `GET /b/{id}/fb2` → 302 на `static.flibusta.is`, 200 zip.
  `GET /b/{id}/epub` → 302 на конвертер, 200 epub. **Авторизация не нужна.**
- Жанры/новинки: `/opds/new`, `/opds/genres`, `/opds/sequencesindex`.
- Для массовой синхронизации есть суточные дампы `/sql/` и инкременты
  `/daily/`, полный каталог `/catalog/catalog.zip` — но для MVP достаточно
  OPDS on-demand.
- Флибуста заблокирована в РФ на уровне провайдеров, но сервер сайта (Vercel/
  VPS вне РФ) достаёт её напрямую; пользователю отдаём уже через свой прокси.

### 2.6. Подкасты — iTunes API + RSS

- `GET https://itunes.apple.com/lookup?id={podcastId}` → `feedUrl`.
  **Проверено на примере из задачи**: `id=1488945593` →
  `https://feeds.transistor.fm/5f1e0bb2-458b-4ac4-8d85-f464a505f813`.
- `GET https://itunes.apple.com/lookup?id={podcastId}&entity=podcastEpisode&
  limit=200&country=RU` → эпизоды. У эпизода: `trackId` (**это и есть `?i=`
  из ссылки Apple**), `trackName`, `episodeUrl` (прямой mp3), `trackTimeMillis`,
  `artworkUrl600`, `description`, `releaseDate`, `episodeGuid`.
- `GET https://itunes.apple.com/search?media=podcast&term=...&country=RU&
  lang=ru_ru` — поиск русских подкастов. `feedUrl` у большинства —
  mave.digital, anchor.fm, transistor.fm.
- `GET https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&
  term=...` — полнотекстовый поиск по эпизодам.
- Лимит порядка 20 запросов/мин → серверный кэш обязателен.
- RSS: `enclosure url` (mp3/m4a), `itunes:duration` (секунды **или**
  `HH:MM:SS` — парсер обязан понимать оба), `itunes:image` канала/эпизода,
  `guid`, `pubDate`, `itunes:season/episode`.
- **`<audio src>` не требует CORS** и поддерживает Range → перемотка
  работает. А вот `fetch()` самого RSS из браузера часто блокируется CORS →
  RSS забираем и парсим **на сервере**, клиенту отдаём JSON.
- **Платные подкасты Apple**: эпизод из примера `i=1000797626192` —
  `lookup?id=1000797626192` → `resultCount: 0`, и его нет в публичном RSS.
  Это Apple Podcasts Subscriptions: доставляются только внутри приложения
  Apple, DRM. Программно недоступны **в принципе**.
- **Приватные RSS** (Patreon `?auth=...`, Boosty, Supporting Cast) — обычный
  RSS; ручной ввод URL с токеном полностью решает «платные» подкасты, где
  есть приватный фид.
- PodcastIndex.org — опциональный fallback (нужен ключ, подпись SHA1), но
  iTunes покрывает русский сегмент лучше и без ключа.

---

## 3. Целевая модель данных

### 3.1. Почему нужен `content_items`

Внешние ID новых типов разнородны: Shikimori id (int), Flibusta id (int),
MangaDex chapter id (UUID), ReManga chapter id (int), Apple collectionId
(до ~2·10⁹), произвольный RSS (строки). Хранить это всё в `shikimori_id`
нельзя без коллизий и без потери источника.

Решение — одна таблица-справочник для **новых** типов; аниме/кино остаются
на своих внешних id, чтобы не ломать рабочий путь:

```sql
create table if not exists content_items (
  id bigint generated by default as identity primary key,
  content_type text not null check (content_type in ('book','manga','ranobe','podcast')),
  source text not null,            -- 'flibusta' | 'shikimori' | 'mangadex' | 'remanga' | 'renovels' | 'itunes' | 'rss' | 'upload'
  external_id text not null,       -- id/URL/uuid в источнике
  title text not null,
  poster_url text,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (content_type, source, external_id)
);
```

`content_items.id` и есть значение `shikimori_id` в таблицах прогресса/списка
для новых типов. Хелпер `resolveContentItem(type, source, externalId, meta)`
делает upsert-on-read и возвращает `id`.

Плюсы: стабильный ключ, много источников на один тайтл, кэш метаданных,
удобно связывать Shikimori-карточку с MangaDex/ReManga.

### 3.2. Миграция прогресса (0051+)

```sql
-- 1. Расширяем допустимые типы во всех таблицах, где есть constraint.
alter table watch_progress drop constraint if exists watch_progress_content_type_check;
alter table watch_progress add constraint watch_progress_content_type_check
  check (content_type in ('anime','cinema','book','manga','ranobe','podcast'));

alter table user_list drop constraint if exists user_list_content_type_check;
alter table user_list add constraint user_list_content_type_check
  check (content_type in ('anime','cinema','book','manga','ranobe','podcast'));

alter table watched_episodes drop constraint if exists watched_episodes_content_type_check;
alter table watched_episodes add constraint watched_episodes_content_type_check
  check (content_type in ('anime','cinema','book','manga','ranobe','podcast'));

-- 2. Универсальная позиция внутри юнита.
alter table watch_progress
  add column if not exists unit text not null default 'seconds',   -- seconds|page|chapter|percent
  add column if not exists progress_percent real,                  -- 0..1
  add column if not exists locator jsonb;                          -- {cfi, chapterId, page, scrollY, chapterLabel}

alter table watch_progress drop constraint if exists watch_progress_unit_check;
alter table watch_progress add constraint watch_progress_unit_check
  check (unit in ('seconds','page','chapter','percent'));
```

Семантика по типам:

| Тип | `episode` | `position_seconds` | `unit` | `locator` |
|---|---|---|---|---|
| podcast | номер эпизода в фиде (1-based) | секунда | `seconds` | `{guid}` |
| book | номер главы (1, если глав нет) | 0 | `percent` | `{cfi, chapterHref}` |
| manga | порядковый номер главы | номер страницы | `page` | `{chapterId, chapterLabel, page, scrollY}` |
| ranobe | номер главы | 0 | `percent` | `{chapterId, scroll, cfi}` |

Важно: `episode` остаётся числом-порядком, а «красивая» метка главы
(`21.2`, `Том 3, глава 5`) живёт в `locator.chapterLabel`. Так сетки и
сортировки остаются целочисленными, а UI показывает человеческий текст.

### 3.3. Что ещё расширить

- `episode_notifications` — для «новая глава манги / новый эпизод подкаста».
  На первом этапе можно не трогать, но constraint расширить заранее.
- `resolved_streams` — не нужен: аудио-URL стабильны, а картинки манги
  проксируются подписанным URL (как `/api/proxy/raw`), без БД-кэша.
- `title_ratings`, `episode_comments`, `watch_parties` — расширить
  `content_type` constraint; ключ `shikimori_id` уже подходит.
- `resolved_streams.shikimori_id` и `watch_parties.shikimori_id` — `bigint`,
  новые id тоже влезут.

---

## 4. Как устроен каждый раздел

### 4.1. Подкасты (самый дешёвый и быстрый)

**Каталог/поиск**: iTunes Search API через серверный прокси + `api_response_cache`.
**Импорт по ссылке**: разобрать `podcasts.apple.com/.../id{pid}?i={eid}` →
`lookup?id={pid}` → `feedUrl`; если есть `i` — `lookup?entity=podcastEpisode`
и матч по `trackId`.
**Эпизоды**: серверный fetch RSS → парсинг (`fast-xml-parser`) → нормализация
`{index, title, audioUrl, duration, image, guid, pubDate}` → кэш.
**Плеер**: свой `<audio>` (не нативные контролы, как в `OwnPlayer`) +
`useProgressSaver` почти без изменений: `content_type='podcast'`,
`episode=index`, `position_seconds`, `duration_seconds`.
**Фичи**: скорость 0.75–2×, ±15/30 сек, sleep-таймер, очередь, «продолжить».
**Платные**: кнопка «Добавить RSS-фид» (принимает Patreon/Boosty с токеном).
Apple-эксклюзивные платные эпизоды — честно показываем «доступно только в
Apple Podcasts», без обхода.

Маршруты: `/podcasts`, `/podcasts/[id]`, `/podcasts/listen/[id]/[episode]`.
API: `/api/podcasts/resolve`, `/api/podcasts/[id]/episodes`,
`/api/podcasts/import`, `/api/podcasts/image` (обложки через прокси при
необходимости).

### 4.2. Книги (Флибуста + EPUB-ридер)

**Каталог**: OPDS. Новинки — `/opds/new/0/new`; жанры — `/opds/genres`;
поиск — `/opds/search?searchType=books&searchTerm=...`. Парсим Atom
(`fast-xml-parser`), нормализуем в `{id, title, authors[], cover, genres[],
formats[]}`.
**Карточка**: `/b/{id}` (HTML можно не парсить: авторы/жанры/аннотация есть в
OPDS-записи; при необходимости — лёгкий парс страницы).
**Чтение**: скачиваем `/b/{id}/epub` через свой прокси и отдаём в
**epub.js** (`epubjs`). EPUB уже готовит сама Флибуста, свой конвертер не
нужен. epub.js даёт CFI, оглавление, темы, шрифт, проценты.
**Прогресс**: `unit='percent'`, `progress_percent`, `locator={cfi}`;
сохранение — по паузе/каждые N секунд и на `beforeunload` (sendBeacon).
**Свои книги**: загрузка EPUB/PDF пользователем в Supabase Storage
(`source='upload'`) — это и есть легальный способ добавить «платную» книгу:
своя копия. PDF — через `pdf.js`, EPUB — через epub.js.
**Прокси файла**: `/api/books/[id]/file?format=epub` — стрим с кэшем
(файлы маленькие, 0,3–1,5 МБ). На Vercel без диска — либо `Cache-Control`,
либо временный кэш в Supabase Storage.

Маршруты: `/books`, `/books/[id]`, `/books/read/[id]/[chapter]`.
API: `/api/books/search`, `/api/books/[id]/file`, `/api/books/upload`.

### 4.3. Манга (Shikimori-метаданные + MangaDex/ReManga-чтение)

Двухслойная схема:

1. **Каталог и карточка** — Shikimori `/api/mangas` (русские названия,
   оценки, жанры, обложки) — единый UX с аниме.
2. **Главы и страницы** — источник чтения:
   - MangaDex по `myanimelist_id` (официальный API, качественные сканы,
     RU-переводы, но маппинг иногда неполный);
   - ReManga по поиску названия (русский каталог, прямые страницы, но
     неофициальный API и часть глав платная).
3. Пользователь переключает источник так же, как сейчас переключает
   видеоплеер (`Player.tsx`).

**Ридер**: вертикальная лента (вебтун) + постраничный режим; ленивая
загрузка, прелоад следующей страницы, сохранение `page`/`scrollY`.
**Прокси картинок**: `/api/manga/image?u=...&s=...` — подпись HMAC, как
`/api/proxy/raw`; скрывает домен источника, обходит Referer, позволяет
кэшировать на CDN. Для MangaDex можно и напрямую (`<img>`), но прокси
надёжнее и единообразнее.
**Платные главы ReManga**: показываем замок, цену и ссылку на источник;
обхода нет.

Маршруты: `/manga`, `/manga/[id]`, `/manga/read/[id]/[chapter]`.
API: `/api/manga/resolve` (маппинг + список глав),
`/api/manga/pages`, `/api/manga/image`.

### 4.4. Ранобэ

Метаданные: Shikimori `/api/ranobe` (оценки, жанры, RU-названия) и/или
Renovels (русский каталог, главы).
Чтение — два пути:
- **A (рекомендуется для MVP)**: искать ранобэ на Флибусте (многие
  официальные переводы там есть) и читать тем же EPUB-ридером, что книги.
- **B**: Renovels как источник глав — требует авторизации/доработки
  (публичный контент-эндпоинт отдаёт 500), поэтому во вторую очередь;
  до этого — кнопка «Читать на источнике».

Прогресс — как у книг (`unit='percent'`, `locator={chapterId, scroll}`).

Маршруты: `/ranobe`, `/ranobe/[id]`, `/ranobe/read/[id]/[chapter]`.

---

## 5. Навигация и UI (самая недооценённая часть)

Сейчас `ModeSwitch` — бинарный «Аниме ↔ Кино», а `mode.ts` знает только два
режима. Шесть разделов в такую схему не влезают.

Предложение:
1. **Хаб `/media`** (или `/library`) — «Продолжить» по всем типам + плитки
   разделов. Это решает «одна вещь ведёт» и не ломает существующие `/` и
   `/cinema`.
2. **Nav**: на десктопе — строка разделов (Аниме, Кино, Книги, Манга,
   Ранобэ, Подкасты) или «Медиатека ▾»; на мобильном — `MobileDock` +
   «Ещё». `ModeSwitch` оставить только для пары аниме/кино либо заменить
   на общий переключатель.
3. **Расширить `mode.ts`**: `modeFromPathname`, `homeHref`, `sectionHref`,
   `normalizeMode`, cookie `aw_mode` — на все шесть значений.
4. **Обобщить карточки**: `PosterImage` уже есть; добавить `MediaCard` с
   разными пропорциями (постер 2:3, обложка книги 2:3, подкаст 1:1) и
   бейджем типа.
5. **`ContinueWatchingPanel`/`ContinueCard`**: научить подписям
   «Глава 21 · 64%», «Эпизод 12 · 23:41», «Стр. 17/42» и ссылкам на нужный
   маршрут. Это общий компонент — расширять аккуратно, чтобы не сломать
   аниме/кино.
6. **Профиль**: вкладки «Мой список» расширить теми же типами; социальные
   таблицы уже ключуются по `content_type + shikimori_id`.
7. **Поиск**: глобальный `/search` — вкладки/секции по типам, параллельные
   запросы с таймаутами (Shikimori + OPDS + MangaDex + iTunes).

---

## 6. Поэтапный план

| Этап | Что делаем | Оценка* |
|---|---|---|
| 0. Фундамент | `content_items`, миграции constraint’ов, `ContentType`, `mode.ts`, навигация, `MediaCard`, общий `Continue` | 3–5 дней |
| 1. Подкасты | iTunes + RSS + `fast-xml-parser`, аудиоплеер, прогресс, импорт по ссылке/приватному RSS | 4–6 дней |
| 2. Книги | Flibusta OPDS, прокси файла, epub.js, прогресс CFI, загрузка своих EPUB/PDF | 6–9 дней |
| 3. Ранобэ | Shikimori/Renovels метаданные, поиск на Флибусте, переиспользование ридера | 3–5 дней |
| 4. Манга | Shikimori-каталог, MangaDex + ReManga, маппинг, ридер, прокси картинок | 8–12 дней |
| 5. Полировка | поиск, профиль, уведомления о главах, кэш, тесты, доступность | 5–7 дней |

\* Один разработчик, без учёта согласований и юридических вопросов.
Итого ориентировочно 5–7 недель; порядок можно менять.

Рекомендуемый порядок: **Подкасты → Книги → Ранобэ → Манга**. Причины:
подкасты дают максимум пользы за минимум кода; книги и ранобэ делят один
ридер; манга — самая тяжёлая по источникам и проксированию.

---

## 7. Риски и ограничения (честно)

1. **Флибуста — теневая библиотека.** Она заблокирована в РФ, распространяет
   книги без прав. На сайте уже есть пиратские видеобалансеры, так что это
   не новый класс риска, но он расширяет поверхность претензий. Меры:
   сайт закрыт приглашениями, файлы не храним постоянно, отдаём через прокси
   по запросу, по жалобе убираем тайтл.
2. **«Все платные книги»** технически = Флибуста (пиратские копии) **или**
   загрузка своей легальной копии. Второй путь корректен юридически и
   покрывает то, чего нет на Флибусте. Рекомендую сделать оба.
3. **«Все платные подкасты»** — невыполнимо для Apple Podcasts Subscriptions:
   платные эпизоды не попадают ни в RSS, ни в API (проверено на эпизоде из
   задачи). Приватные RSS (Patreon/Boosty) — работают. Это ограничение
   платформы, а не нашего кода.
4. **ReManga/Renovels** — неофициальные API, могут закрыться/сменить
   эндпоинты; часть контента платная или гео-ограничена. Нужен graceful
   degradation и переключатель источников.
5. **MangaDex** — официальный, но rate limit и неполный маппинг Shikimori→MAL;
   часть глав — внешние ссылки.
6. **Проксирование и стоимость.** Картинки манги — десятки МБ на главу,
   книги — сотни КБ. На Vercel serverless это трафик и лимиты времени.
   Если разделы пойдут в массы, прокси чтения стоит вынести на VPS
   (nginx + pm2), как уже сделано для LifeDashboard, а Vercel оставить
   фронтенду. Решение требует замера, не догадки.
7. **Права и ToS.** MangaDex просит атрибуцию и разумные лимиты; ReManga/
   Renovels — серая зона; Apple — DRM. Пользователь принимает решение о
   допустимости для своего проекта.

---

## 8. Открытые вопросы (нужны решения до кода)

1. **С чего начинаем?** Рекомендация: подкасты, затем книги.
2. **Читаем внутри сайта или ведём только трекер?** Полный ридер — больше
   кода и трафика; трекер + внешняя ссылка — быстрее, но хуже UX.
3. **Где проксировать тяжёлое** — Vercel или VPS (`media-watch.ru`)?
4. **Нужны ли свои загрузки книг/PDF** (легальные «платные» копии)?
5. **Навигация**: хаб `/media` или просто добавить разделы в шапку?
6. **Платные главы ReManga**: показывать замок со ссылкой или скрывать?
7. **Уведомления**: нужны ли «новая глава манги / новый эпизод подкаста»
   на первом этапе?

---

## 9. Приложение: проверенные примеры запросов

```
# Shikimori
GET https://shikimori.io/api/mangas?limit=1
GET https://shikimori.io/api/ranobe?limit=1
GET https://shikimori.io/api/mangas/{id}

# MangaDex
GET https://api.mangadex.org/manga?limit=3&availableTranslatedLanguage[]=ru&includes[]=cover_art&order[followedCount]=desc
GET https://api.mangadex.org/chapter?manga={uuid}&translatedLanguage[]=ru&order[chapter]=asc
GET https://api.mangadex.org/at-home/server/{chapterId}

# ReManga
GET https://api.remanga.org/api/search/?query={q}
GET https://api.remanga.org/api/titles/{dir}/
GET https://api.remanga.org/api/titles/chapters/?branch_id={id}&count=1&page=1
GET https://api.remanga.org/api/titles/chapters/{chapterId}/

# Renovels
GET https://api.renovels.org/api/search/catalog?query={q}
GET https://api.renovels.org/api/titles/{dir}/
GET https://api.renovels.org/api/titles/chapters/?branch_id={id}&count=1&page=1

# Флибуста
GET https://flibusta.is/opds
GET https://flibusta.is/opds/search?searchType=books&searchTerm={q}
GET https://flibusta.is/b/{id}/epub

# Подкасты
GET https://itunes.apple.com/lookup?id={podcastId}
GET https://itunes.apple.com/lookup?id={podcastId}&entity=podcastEpisode&limit=200&country=RU
GET https://itunes.apple.com/search?media=podcast&term={q}&country=RU&lang=ru_ru
```
