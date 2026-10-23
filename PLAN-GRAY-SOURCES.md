# MediaWatch — план: максимум контента из «серой зоны»

**Черновик технического плана. Отдельный документ, расширяет `SESSION-REPORT.md`
и `PLAN-CONTENT-EXPANSION.md`, но не переписывает их.**

**Дата:** 23.10.2026  
**Ревизия:** 2 (после архитектурного ревью)  
**Статус:** план + каркас кода.  
**Цель:** получить максимум читаемого контента без партнёрств, покупок и
пользовательских загрузок — за счёт публичных API и парсинга фанатских
агрегаторов, по той же «серой» логике, что уже используется с Флибустой.

> **Что изменилось в ревизии 2.** Найдены и исправлены шесть блокирующих
> несоответствий: (1) `shikimori_id` — это не Shikimori, а id источника,
> поэтому колонка называется `title_key`, а маппинг MangaDex идёт по
> названию/году/автору, не по MAL; (2) добавлена каноническая модель глав
> (`canonical_chapters` + `chapter_sources`), без неё прогресс и переключение
> источника ломаются; (3) `title_sources` получил `variant` в уникальном
> ключе; (4) маршруты читателя стали каноническими — `/read/[dir]/[idx]` с
> `?source=`; (5) TTL at-home MangaDex снижен до 10 минут; (6) allowlist
> прокси — по суффиксам хостов, а не точный. Подробнее — в разделах ниже.

---

## 1. Задача и жёсткие ограничения

### 1.1. Задача

Для манги и ранобэ добавить источники чтения, которые:

- отдают **бесплатные** главы/тома без авторизации и покупки;
- покрывают как можно больше тайтлов, включая те, что на Remanga / Renovels
  помечены платными;
- не требуют партнёрства, API-ключей, покупок и пользовательских загрузок;
- переиспользуют существующую архитектуру: `watch_progress`, индексы, прокси,
  кроны, ридеры.

### 1.2. Ограничения (приняты как есть)

| Ограничение | Следствие |
|---|---|
| Без партнёрств | Нельзя легально получить платные главы Remanga / Renovels / Манары |
| Без покупок | Нет доступа к официальным платным каталогам |
| Без пользовательских загрузок | Нет `source='upload'`, нет CBZ/EPUB-импорта |
| Только «серая зона» | Работаем с фанатскими переводами и пиратскими зеркалами |
| Контент не храним | В БД только id и лёгкие метаданные; страницы/файлы — live |

### 1.3. Ключевая честная предпосылка

**«Аналога Флибусты для манги не существует».** Поэтому план не обещает
«одну кнопку со всем платным». Он собирает максимум из **нескольких
разрозненных бесплатных источников** и честно показывает, где контента нет.

Ожидаемое покрытие (оценка, проверяется на этапе 0):

| Категория | Покрытие бесплатным |
|---|---|
| Популярная манга/манхва (RU) | ~70–85% через MangaDex + фанатские агрегаторы |
| Нишевая манга | ~40–60% |
| Официальные платные главы (Remanga/Renovels-эксклюзив) | ~0–15% (только если есть фанатский дубль) |
| Ранобэ (официальные переводы) | ~50–70% через Флибусту (EPUB/FB2 по томам) |

Цифры — гипотеза. Этап 0 её измеряет, а не принимает на веру.

---

## 2. Что уже есть (переиспользуем без изменений)

| Компонент | Как используется |
|---|---|
| `content_type + shikimori_id` | Остаётся ключом тайтла; новый источник не создаёт второй тайтл |
| `watch_progress` (`unit`, `progress_percent`, `locator`) | Прогресс остаётся на тайтл, а не на источник |
| `watched_episodes` | Отметки глав по любому источнику |
| `/api/progress` | Единая точка сохранения, менять не нужно |
| `/api/proxy/raw` (HMAC + ресайз) | Прокси страниц MangaDex и фанатских сайтов |
| `pg_trgm` | Поиск по подстроке в своём индексе |
| Паттерн «индекс + ночной крон + state-таблица» | Новые источники добавляются как поля/строки индекса |
| `MangaReader` / `RanobeReader` / `BookReader` | UI не меняется, меняется слой загрузки данных |
| `adminJobs` + `/admin/status` | Новые джобы и секции по тому же шаблону |

**Главный вывод:** второй архитектуры не будет. Добавляется **слой
резолвинга источников** и **таблица соответствий id**.

---

## 3. Принципы расширения

### 3.1. Один тайтл — много источников

```
(shikimori_id, content_type)
   ├── source: remanga    → external_id: dir / chapter int
   ├── source: mangadex   → external_id: manga uuid / chapter uuid
   ├── source: selfmanga  → external_id: slug / chapter slug
   ├── source: flibusta   → external_id: book id (для ранобэ)
   └── source: renovels   → external_id: dir / chapter int
```

Тайтл один. Прогресс один. Источник — это «канал доставки страниц/текста».

### 3.2. Резолвер, а не ветвление в каждом компоненте

Все читатели работают с **нормализованным контрактом**:

```typescript
// src/lib/sources/types.ts
export interface ResolvedChapter {
  source: SourceId;
  chapterKey: string;        // string: int или uuid
  chapterIndex: number;
  chapterLabel: string;
  isPaid: boolean;
  isFreeToday: boolean;
}

export interface ResolvedPages {
  source: SourceId;
  pages: { url: string; width?: number; height?: number }[];
  format: 'images' | 'html' | 'epub';
}
```

Резолвер выбирает источник по приоритету и доступности. Ридер ничего не знает
про Remanga/MangaDex/Флибусту.

### 3.3. Деградация

- источник упал → пробуем следующий по приоритету;
- все упали → показываем сохранённые метаданные из индекса;
- глава помечена платной у одного источника, но есть у другого → открываем
  бесплатный;
- ошибка источника не кэшируется.

### 3.4. Флаги источников

Каждый источник включается/выключается переменной окружения, чтобы можно было
отключить хрупкий парсер без деплоя:

```env
SOURCE_MANGADEX=enabled
SOURCE_SELFManga=enabled
SOURCE_YAI=enabled
SOURCE_MINTMANGA=enabled
SOURCE_FLIBUSTA=enabled
```

---

## 4. Модель данных

### 4.1. Ключ тайтла: `title_key`, а не `shikimori_id`

Важное уточнение по ревизии 2. В существующей схеме `shikimori_id` хранит
**id источника**, а не Shikimori:

- манга — id Remanga;
- ранобэ — id Renovels;
- книги — id Флибусты.

Поэтому в новых таблицах колонка называется `title_key`. Это тот же числовой
id, что лежит в `watch_progress.shikimori_id` для соответствующего
`content_type`, но без ложного намёка на Shikimori. Переименование не ломает
прогресс: `title_key` = `shikimori_id` для чтения.

Следствие: **маппинг MangaDex нельзя строить по `myanimelist_id`** — в
`manga_index`, собранном из Remanga, такого поля нет. Маппинг идёт по
названию/altTitles/году/автору с `confidence` (см. §5.1).

### 4.2. Три таблицы вместо одной

Одной `title_sources` недостаточно: нужна каноническая ось глав, иначе
`chapterIndex` разных источников не совпадает и прогресс «съезжает».

```sql
-- 1. Где тайтл лежит в источнике (корень тайтла, не глава).
create table if not exists title_sources (
  id bigint generated by default as identity primary key,
  content_type text not null check (content_type in ('manga','ranobe','book')),
  title_key bigint not null,           -- id Remanga/Renovels/Флибусты (= shikimori_id)
  source text not null,                -- remanga | mangadex | mangalib | selfmanga | mintmanga | yai | renovels | flibusta
  external_id text not null,           -- dir / manga uuid / slug / book id
  external_url text,
  -- Вариант внутри источника: том Флибусты, язык/группа MangaDex, издание.
  variant text not null default 'default',
  title text,
  chapters_count int,
  language text,                       -- ru | en | raw
  confidence real not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_type, title_key, source, variant)
);

create index if not exists title_sources_lookup
  on title_sources (content_type, title_key) where is_active;
create index if not exists title_sources_external
  on title_sources (source, external_id);

-- 2. Каноническая глава тайтла. Одна на тайтл, общая для всех источников.
create table if not exists canonical_chapters (
  content_type text not null check (content_type in ('manga','ranobe','book')),
  title_key bigint not null,
  idx int not null,                    -- порядковый номер 1..N; уходит в progress.episode
  chapter_no numeric,                  -- 21.2 (может быть дробным)
  label text not null,                 -- «Том 3, глава 21.2»
  primary key (content_type, title_key, idx)
);

-- 3. Где каноническая глава доступна.
create table if not exists chapter_sources (
  content_type text not null check (content_type in ('manga','ranobe','book')),
  title_key bigint not null,
  idx int not null,
  source text not null,
  source_chapter_key text not null,    -- int, uuid или slug у источника
  is_paid boolean not null default false,
  is_free_today boolean not null default false,
  pages_count int,
  primary key (content_type, title_key, idx, source),
  unique (content_type, title_key, source, source_chapter_key)
);
```

Почему так:

- **`variant`** позволяет хранить несколько томов Флибусты, несколько языков и
  групп переводов MangaDex — старый `unique (…, source)` это запрещал;
- **`canonical_chapters`** даёт стабильный `idx` для прогресса, не зависящий
  от источника;
- **`chapter_sources`** отвечает на вопрос «где эта глава бесплатна», не
  дублируя главу в прогрессе;
- одна структура и для манги, и для ранобэ, и для книг.

### 4.2.1. Правила канонизации

1. Номер главы нормализуется в `chapter_no numeric` (`"21.2"` → `21.2`,
   `"Пролог"` → `0`).
2. Сортировка по `chapter_no`, затем `idx = 1..N`.
3. Дубли одной главы у одного источника (разные группы MangaDex) схлопываются:
   приоритет — `pages > 0`, `ru`, не `externalUrl`, затем свежесть.
4. Нечисловые главы (`Extra`, `Omake`) получают `chapter_no = prev + 0.001`,
   метка сохраняется в `label`.
5. Глава считается бесплатной, если **хотя бы один** источник отдаёт её
   бесплатно (`is_paid = false`).
6. Прогресс пишет `episode = idx`, а не номер главы. Номер и метка живут в
   `locator`.

### 4.3. Расширение `locator` (обратная совместимость)

Текущий `locator` манги:
```json
{ "dir": "...", "chapterId": 120199, "chapterIndex": 1, "page": 3, "pagesCount": 42, "scrollPercent": 0.18 }
```

Новый (старые поля сохраняются, добавляются `source`, `chapterKey` и
канонический `idx`):
```json
{
  "source": "mangadex",
  "chapterKey": "a1b2c3d4-...",
  "idx": 12,
  "dir": "solo-leveling_",
  "chapterId": 120199,
  "chapterIndex": 1,
  "chapterNo": 21.2,
  "chapterLabel": "Глава 21.2",
  "page": 3,
  "pagesCount": 42,
  "scrollPercent": 0.18,
  "chaptersCount": 38
}
```

Правила:

- `watch_progress.episode` = **канонический `idx`**, стабильный для тайтла;
- позиция внутри главы (`page`/`scrollPercent`) применяется, только если
  совпали `(source, chapterKey)`; иначе глава открывается с начала;
- при переключении источника № главы сохраняется (`idx`), а номер у
  источника берётся из `chapter_sources`;
- старые записи без `source` трактуются как `remanga` / `renovels`, а
  `episode` — как прежний `chapterIndex`.

### 4.4. Расширение индексов: не добавляем колонки

В ревизии 1 предлагалось `manga_index.mangadex_id` и
`ranobe_index.flibusta_id`. От этого решено отказаться:

- у источника может быть несколько вариантов (язык, группа, том), одна
  колонка их не выражает;
- денормализация рассинхронизируется с `title_sources`;
- каталогу эти поля не нужны — карточка и так читает `title_sources` по
  `(content_type, title_key)`.

Вместо колонок — индексы на `title_sources` (§4.2) и, при необходимости,
VIEW `title_primary_source` для быстрого чтения основного маппинга.

### 4.5. Здоровье источников и состояние маппинга

```sql
create table if not exists source_health (
  source text primary key,
  enabled boolean not null default true,   -- kill-switch без деплоя
  last_ok_at timestamptz,
  last_error text,
  errors_24h int not null default 0,
  latency_ms int,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Курсор chunked-крона: один вызов обрабатывает батч и возвращается.
create table if not exists source_link_state (
  id boolean primary key default true check (id),
  content_type text not null default 'manga',
  last_cursor bigint not null default 0,
  titles_total int not null default 0,
  titles_done int not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);
```

`source_health` пишется из адаптеров (best-effort, через service_role) и
читается в `/admin/status`. `enabled` дублирует env-флаг, чтобы админка могла
выключить источник мгновенно.

**RLS:** `title_sources`, `canonical_chapters`, `chapter_sources` — `select`
для `anon`/`authenticated`; `source_health`, `source_link_state` — только
`authenticated` (админка), запись — только `service_role`.

---

## 5. Источники по приоритету

### 5.1. MangaDex — основной бесплатный источник манги

**Почему:** официальный публичный API, 100k+ русских глав, стабильные
эндпоинты, нет платных глав, есть постраничные изображения.

**Что даёт:** главы и страницы для ~60–70% популярных тайтлов.

**Ключевые эндпоинты (проверены в `PLAN-CONTENT-EXPANSION.md`):**

```http
GET https://api.mangadex.org/manga?title={q}&availableTranslatedLanguage[]=ru&includes[]=cover_art&limit=20
GET https://api.mangadex.org/manga?ids[]={uuid}&includes[]=cover_art
# limit у /chapter — максимум 100 (500 → 400), пагинация по offset
GET https://api.mangadex.org/chapter?manga={uuid}&translatedLanguage[]=ru&order[chapter]=asc&limit=100&offset=0
GET https://api.mangadex.org/at-home/server/{chapterUuid}
```

Страница:
```
{baseUrl}/data/{hash}/{file}          // качество
{baseUrl}/data-saver/{hash}/{file}    // экономия трафика
```

**Маппинг тайтла (исправлено в ревизии 2):** `manga_index` собран из Remanga,
и `myanimelist_id` в нём нет. Поэтому маппинг строится так:

1. `GET /manga?title={title}&limit=10&includes[]=cover_art`;
2. нормализовать названия (lowercase, убрать пунктуацию/тома);
3. сравнить с `title`, `original_title`, `alternative_title` и `altTitles`
   MangaDex;
4. балл за совпадение года (±1), типа (manga/manhwa/manhua) и автора;
5. `confidence` = взвешенная сумма; ниже порога — не показывать;
6. если в `attributes.links.mal` есть MAL id и он совпал с известным —
   `confidence = 1`.

`manga.links.mal` используется как **бонус к уверенности**, а не как
единственный путь.

**Ограничения и меры:**

| Ограничение | Мера |
|---|---|
| Rate limit ~5 rps | очередь + пауза 250 мс, общий семафор |
| Часть глав `externalUrl` | пропускаем, помечаем «внешняя глава» |
| Неполный маппинг | `confidence`, ручное подтверждение в админке |
| Официальная атрибуция | ссылка на источник в карточке |

**Модуль:** `src/lib/sources/mangadex.ts`  
**Адаптер:** реализует `SourceAdapter` (см. §6).

---

### 5.2. Фанатские агрегаторы — расширение покрытия

Цель — найти главы, которых нет на MangaDex: русские фан-переводы, вебтуны,
манхва.

| Источник | Тип доступа | Стабильность | Приоритет |
|---|---|---|---|
| **SelfManga** (`selfmanga.ru`) | HTML-парсинг, есть RSS и внутренние JSON-ручки | средняя | 2 |
| **MangaLib / cdnlibs** | Внутренний JSON API (`api.mangalib.me` / `api.cdnlibs.org`), требует `Referer`/`User-Agent` | средняя | 2 |
| **Yai** (`yai.su`) | **мёртв**: NXDOMAIN по Cloudflare/Google DoH (23.10.2026) | — | — |
| **MintManga** (`mintmanga.com`) | HTML-парсинг, тот же движок, что SelfManga | средняя | 3 |

**Статус:** MangaLib реализован (`src/lib/sources/mangalib.ts`) и включён по
умолчанию; API проверен живьём (поиск, главы, страницы, картинки с Referer).
SelfManga реализован через общий `readmangaEngine.ts` и включён. MintManga
умеет маппинг/оглавление, но 18+ главы требуют логин — выключена. Yai не
существует: `yai.su` отдаёт NXDOMAIN по Cloudflare и Google DoH, `yai.me` и
`yai.one` — парковки. Адаптер для мёртвого домена не пишем.

**Общие правила для парсеров:**

1. Только `GET`, только публичные страницы, без авторизации.
2. Свой `User-Agent` с названием проекта и контактом.
3. Пауза ≥ 500 мс между запросами к одному домену.
4. Результат парсинга кэшируется на 6–24 часа (главы), страницы — на 1 час.
5. Любое изменение вёрстки → парсер возвращает `null`, источник помечается
   `degraded` в `source_health`, остальные продолжают работать.
6. Селекторы вынесены в конфиг (`selectors.ts`), чтобы правка была в одном месте.
7. `robots.txt` и ToS проверяются перед включением; при запрете — источник
   выключается флагом.

**Модули:**

```
src/lib/sources/selfmanga.ts
src/lib/sources/mangalib.ts
src/lib/sources/yai.ts
src/lib/sources/mintmanga.ts
src/lib/sources/selectors.ts
```

**Что нормализуем:** название, альтернативные названия, год, тип, обложка,
список глав (номер, метка, url), страницы главы (url изображений).

**Важно:** эти источники — «серая зона». Они не дают API-гарантий. Поэтому они
всегда **вторичны**: сначала MangaDex, потом они, и только потом замок.

---

### 5.3. Флибуста — ранобэ по томам (сильный кейс)

**Почему это работает лучше всего:** официальные переводы ранобэ часто лежат
на Флибусте как FB2/EPUB по томам, а твой `BookReader` уже умеет EPUB.

**Схема:**

```
Карточка ранобэ (Renovels / Shikimori)
   → поиск по названию (+ автор, + том) на Флибусте
   → найден book_id → строка в title_sources (source='flibusta')
   → кнопка «Читать том» → /books/read/[book_id] (существующий EPUB-ридер)
```

**Маппинг названий:** русское название из Renovels/Shikimori → OPDS-поиск →
проверка автора и года → `confidence`.

**Модуль:** `src/lib/sources/flibustaRanobe.ts` (переиспользует `src/lib/books.ts`).

**Что не делаем:** не пытаемся читать мангу из FB2-томов (нет смысла, см.
обсуждение в чате). Только ранобэ/книги.

---

### 5.4. Raw-источники (опционально, низкий приоритет)

Сырые сканы без перевода (`rawkuma`, `mangaraw` и т. п.) дают контент, но не
дают русского текста. Для пользователя бесполезны без перевода.

**Решение:** не включать в MVP. Оставить точку расширения в реестре источников.

---

### 5.5. Telegram-каналы (опционально, вне сайта)

Приватные сливы платных глав живут в Telegram, а не на сайтах. Автоматически и
стабильно их нельзя встроить.

**Вариант, если понадобится:** отдельный бот-поисковик (Telethon), который по
названию отдаёт ссылки на `.cbz`/`.zip` в файлхостингах. Сайт даёт deeplink
`tg://resolve?domain=...&start=...`. Сайт не хранит и не проксирует файлы.

**Статус:** не входит в этот план; вынесено в «идеи».

---

## 6. Слой источников (ядро плана)

### 6.1. Контракт адаптера

Ключевые типы (файл `src/lib/sources/types.ts`, без импортов — чтобы
клиентские компоненты могли брать оттуда только типы).

```typescript
export type ReadingContentType = 'manga' | 'ranobe' | 'book';

export type SourceId =
  | 'remanga' | 'mangadex' | 'selfmanga' | 'mangalib' | 'yai' | 'mintmanga'
  | 'renovels' | 'flibusta';

export type SourceKind = 'manga' | 'ranobe' | 'book';

export interface SourceTitleKey {
  contentType: ReadingContentType;
  /** id источника-каталога (= shikimori_id прогресса), НЕ Shikimori id. */
  titleKey: number;
  title: string;
  altTitles?: string[];
  year?: number;
}

export interface SourceMatch {
  source: SourceId;
  externalId: string;
  /** Вариант внутри источника: том, язык, группа перевода. */
  variant: string;
  title: string;
  confidence: number;      // 0..1
  chaptersCount?: number;
  language?: string;
  externalUrl?: string;
}

/** Глава у конкретного источника. Не путать с канонической главой. */
export interface SourceChapter {
  source: SourceId;
  chapterKey: string;      // string: int, uuid или slug
  chapterNo: number | null;
  label: string;
  isPaid: boolean;
  isFreeToday: boolean;
  pagesCount?: number;
}

export interface ResolvedPage {
  url: string;
  width?: number;
  height?: number;
}

export type ResolvedContent =
  | { format: 'images'; pages: ResolvedPage[] }
  | { format: 'html'; html: string }
  | { format: 'epub'; url: string };

export interface SourceAdapter {
  id: SourceId;
  kind: SourceKind;
  /** Включён ли источник (env-флаг + health). */
  isEnabled(): boolean;
  /** Найти тайтл в источнике. */
  findByTitle(input: SourceTitleKey): Promise<SourceMatch | null>;
  /** Список глав. */
  listChapters(match: SourceMatch): Promise<SourceChapter[]>;
  /** Контент одной главы. Платную главу не запрашиваем. */
  getChapter(match: SourceMatch, chapterKey: string): Promise<ResolvedContent | null>;
}
```

`getChapter` вместо `getPages`: у манги это `images`, у ранобэ `html`, у
Флибусты `epub`. Дискриминированный union не даёт вернуть «страницы» там, где
их не бывает.

### 6.2. Реестр и порядок

```typescript
// src/lib/sources/registry.ts
import { remanga } from './remanga';
import { mangadex } from './mangadex';
import { selfmanga } from './selfmanga';
import { mangalib } from './mangalib';
import { yai } from './yai';
import { mintmanga } from './mintmanga';
import { renovels } from './renovels';
import { flibustaRanobe } from './flibustaRanobe';

export const SOURCES: Record<SourceKind, SourceAdapter[]> = {
  manga:  [remanga, mangadex, mangalib, selfmanga, mintmanga, yai],
  ranobe: [renovels, flibustaRanobe],
  book:   [/* существует отдельно, не трогаем */],
};
```

Порядок в массиве = приоритет. `remanga` остаётся первым, потому что уже
работает и даёт метаданные; но если глава платная — резолвер переключается на
следующий источник, где она бесплатна.

### 6.3. Резолвер

```typescript
// src/lib/sources/resolve.ts (server-only)
export interface CanonicalChapter {
  idx: number;
  chapterNo: number | null;
  label: string;
  sources: {
    source: SourceId;
    chapterKey: string;
    isPaid: boolean;
    isFreeToday: boolean;
    pagesCount?: number;
  }[];
}

/** Каноническое оглавление тайтла. Строится один раз и кэшируется в БД. */
export async function getCanonicalChapters(
  key: SourceTitleKey,
  options?: { refresh?: boolean },
): Promise<CanonicalChapter[]>;

/** Контент канонической главы. */
export async function resolveChapterContent(
  key: SourceTitleKey,
  idx: number,
  preferred?: SourceId,
): Promise<
  | { ok: true; source: SourceId; chapterKey: string; content: ResolvedContent }
  | { ok: false; reason: 'paid' | 'not-found' | 'unavailable' }
>;

/** Дозаполнить title_sources, если маппингов нет. */
export async function ensureTitleSources(
  key: SourceTitleKey,
): Promise<SourceMatch[]>;
```

Порядок выбора в `resolveChapterContent`:

1. если `preferred` указан и глава там бесплатна — берём его;
2. иначе идём по `registry` в порядке приоритета;
3. пропускаем `isPaid && !isFreeToday`;
4. первый успешный `getChapter` выигрывает;
5. если все платные — `{ ok:false, reason:'paid' }`.

Резолвер — единственное место, где известно про несколько источников.
Компоненты получают уже нормализованные данные.

### 6.4. Кэш

| Данные | TTL | Где |
|---|---|---|
| `title_sources` (маппинги) | бессрочно, обновление кроном | Postgres |
| `canonical_chapters` / `chapter_sources` | 24 ч (или до `refresh`) | Postgres |
| Список глав у источника | 6–24 ч | `api_response_cache` |
| Список файлов главы (без `baseUrl`) | 24 ч | Postgres / cache |
| **`at-home` MangaDex (`baseUrl` + `hash`)** | **≤ 10 мин** | только память/короткий кэш |
| Ошибки | не кэшировать | — |

Критично: URL `at-home` MangaDex живут ~15 минут. Кэшировать их на час —
значит отдавать битые `<img>` через 15 минут. Поэтому кэшируется только
`chapterId` → список файлов, а `baseUrl` запрашивается заново при каждом
открытии главы (или при `403` на картинке).

Ключ кэша: `source + externalId + chapterKey`. Существующий
`api_response_cache` переиспользуется только после проверки схемы; иначе —
отдельная `source_cache`.

---

## 7. Читатели

### 7.1. Маршруты: канонические, а не source-specific

Старые маршруты привязаны к id Remanga (`/manga/read/[dir]/[chapterId]`), а у
MangaDex — UUID, у SelfManga — slug. Один URL так не работает.

Новые маршруты:

```text
/manga/read/[dir]/[idx]                 # авто-выбор источника
/manga/read/[dir]/[idx]?source=mangadex # явный выбор
/ranobe/read/[dir]/[idx]?source=renovels
```

- `idx` — канонический номер из `canonical_chapters`, а не id источника;
- старые ссылки `/manga/read/[dir]/[chapterId]` редиректят на канонический
  `idx` через lookup `chapter_sources`;
- deep link стабилен при смене источника.

### 7.2. Изменения в `MangaReader`

- получает `CanonicalChapter[]` из `getCanonicalChapters` (у каждой главы —
  список источников и флаги `isPaid`/`isFreeToday`);
- при открытии главы вызывает `resolveChapterContent(key, idx, preferred)`;
- в оглавлении у каждой главы бейдж доступных источников (`RM`, `MD`, `ML`,
  `SM`, `YAI`);
- `SourceSwitcher` показывает только источники, где глава бесплатна;
- в `locator` пишутся `source`, `chapterKey`, `idx`, `chapterNo`,
  `chapterLabel`, `page`, `scrollPercent`;
- все источники платные → `PaidLock` без запроса страниц.

### 7.3. Изменения в `RanobeReader`

- та же схема для глав Renovels (`idx` канонический);
- кнопка «Читать том на Флибусте» → `/books/read/[bookId]` (EPUB-ридер);
- прогресс по EPUB-тому остаётся `book`/`percent` и не смешивается с
  `ranobe`/`chapter` (два разных ключа прогресса: Flibusta book id и Renovels
  title id);
- в «Продолжить» такие две записи дедуплицируются по названию и показываются
  одной карточкой с двумя вариантами: «Глава 12» и «Том 3, 64%».

### 7.4. UI-компоненты

| Компонент | Роль |
|---|---|
| `SourceBadge` | иконка/метка источника |
| `SourceSwitcher` | выбор источника для тайтла |
| `ChapterSources` | у главы: где доступна, где платная |
| `PaidLock` | заглушка, если бесплатных версий нет |
| `SourceHealthBanner` | «источник X недоступен, показан Y» |

### 7.5. Прогресс и переключение источника

Прогресс **не привязан к источнику** (ключ `user_id + content_type +
title_key` = `shikimori_id`). `episode` = канонический `idx`.

При переключении источника:

- `idx` остаётся тем же, поэтому «Продолжить» ведёт на ту же главу;
- позиция внутри главы применяется, только если совпали
  `(source, chapterKey)`; иначе глава открывается с начала;
- если у нового источника глава помечена платной — резолвер берёт следующий
  бесплатный источник или показывает `PaidLock`;
- общий процент тайтла (`progress_percent`) не сбрасывается.

---

## 8. Индексы, кроны, поиск

### 8.1. Что индексируем

`manga_index` / `ranobe_index` остаются витриной и не меняются. Маппинги
живут отдельно:

- `title_sources` — корень тайтла в каждом источнике (с `variant`);
- `canonical_chapters` — каноническое оглавление;
- `chapter_sources` — доступность глав по источникам;
- VIEW `title_primary_source` — быстрый выбор основного маппинга для карточки.

### 8.2. Крон маппинга манги — chunked, с курсором

`/api/cron/link-manga-sources` (новый). Один вызов **не** живёт 60 минут: на
serverless это невозможно. Вместо этого — батч и возврат.

1. Читает `source_link_state.last_cursor`.
2. Берёт следующие 100 тайтлов из `manga_index` по `title_id`.
3. Для каждого: MangaDex `findByTitle` (название/altTitles/год/автор), не MAL.
4. Upsert в `title_sources` (с `variant` и `confidence`), затем
   `ensureCanonicalChapters` для новых маппингов.
5. Обновляет `last_cursor`, `titles_done`.
6. Возвращает `{ done: boolean, cursor, processed }`.

VPS-крон дёргает endpoint каждые 5 минут, пока `done=false`. Альтернатива —
`after()`/self-invoke. **Никаких 60-минутных функций.**

**Расписание:** 7:40 (после `reindex-manga` в 7:20), повтор до `done`.

### 8.3. Крон маппинга ранобэ

`/api/cron/link-ranobe-flibusta` — та же chunked-схема:

1. Берёт `ranobe_index` пачками по `title_id`.
2. OPDS-поиск по русскому названию + автор.
3. Проверка: жанр «фантастика»/«новеллизация», год, автор.
4. `confidence` по совпадению названия и автора.
5. Upsert в `title_sources` с `variant = 'том {N}'` (по одному тому — одна
   строка; это и есть причина, по которой `variant` обязателен).

**Расписание:** 7:50, повтор до `done`.

### 8.4. Поиск и ленивый маппинг

- по индексу — как сейчас (`pg_trgm`);
- в карточке — параллельный `findByTitle` по источникам, **но не во время
  server render**;
- ленивый маппинг выполняется через `/api/sources/resolve` (client fetch) или
  в фоне (`after()`), результат кэшируется в `title_sources`;
- negative-cache: «не найдено» хранится 24 ч, чтобы не дёргать источники на
  каждом открытии;
- таймаут `findByTitle` — 8 с; карточка не ждёт медленный источник;
- глобальный `/search` (если делать) — те же адаптеры.

**Почему нельзя писать в БД из Server Component:** GET с побочным эффектом
даёт гонки при параллельных рендерах и упирается в RLS. Пишем только из route
handler / крона.

### 8.5. Предохранители (как в существующих кронах)

- минимальная выборка;
- пауза между запросами;
- ошибки не затирают существующие маппинги;
- sweep только после успешного прогона;
- таймаут задачи.

---

## 9. Прокси и трафик

Страницы манги — тяжёлые (десятки МБ на главу). Меры:

| Мера | Детали |
|---|---|
| Подписанный прокси | `/api/proxy/raw` уже есть, HMAC (`signImageUrl` / `signRawUrl`) |
| Referer/UA источника | передаются в подписанном payload (`h`) |
| `data-saver` | MangaDex отдаёт облегчённые изображения |
| Лимит размера | отказ от страниц > N МБ |
| `Cache-Control` | `public, max-age=3600, stale-while-revalidate` |
| CDN | при росте — вынести картинки на CDN/VPS |
| Range | для EPUB/аудио уже есть |

**Allowlist — по суффиксам, не по точным хостам.** Это исправление ревизии 2:
MangaDex отдаёт динамический `baseUrl` (`*.mangadex.network`), поэтому
статический список хостов ломается.

```typescript
const ALLOWED_HOST_SUFFIXES = [
  '.mangadex.network', '.mangadex.org', '.reimg2.org',
  '.selfmanga.ru', '.mintmanga.com', '.mangalib.me', '.cdnlibs.org',
  '.flibusta.is', '.flibusta.site',
];

export function assertAllowedUpstream(url: string): void {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error(`upstream host not allowed: ${host}`);
  }
}
```

Основная защита — не allowlist, а HMAC-подпись: браузер не может заказать
произвольный URL. Allowlist — вторая линия, чтобы адаптер не подписал
случайный домен.

**Проверять host на стороне адаптера при подписи**, а не только в прокси:
`verifyRawToken` уже гарантирует, что URL подписали мы.

---

## 10. Админка и наблюдаемость

В `/admin/status` добавить:

- секцию «Источники»: включён/выключен, `last_ok_at`, `errors_24h`,
  `latency_ms`;
- счётчики маппинга: сколько тайтлов с 1, 2, 3+ источниками;
- кнопки ручного запуска `link-manga-sources` и `link-ranobe-flibusta`;
- список тайтлов с `confidence < 0.7` для ручной проверки;
- кнопку «выключить источник» (пишет флаг в `source_health`/env).

Метрики для логов:

```
source=remanga op=getPages ok=false code=401 ms=120
source=mangadex op=chapter ok=true count=42 ms=310
source=mangalib op=parse ok=false reason=selector_miss
```

---

## 11. Риски и правовые заметки

1. **Фанатские агрегаторы — серая зона.** Парсинг нарушает ToS части сайтов.
   Источники включаются флагом; при жалобе — выключаются.
2. **Хрупкость парсеров.** Любой редизайн ломает селекторы. Меры: конфиг
   селекторов, health, деградация, «не кэшировать ошибки».
3. **MangaDex просит атрибуцию и разумные лимиты.** Соблюдаем: ссылка на
   источник, семафор, User-Agent.
4. **Платные эксклюзивы всё равно останутся закрытыми.** Это не баг. План
   максимизирует бесплатное, а не обходит защиту.
5. **Трафик.** Прокси картинок — основная стоимость. Нужен замер после MVP;
   при росте — VPS/CDN.
6. **Юридический риск проекта растёт** вместе с числом пиратских источников.
   Решение о допустимости принимает владелец проекта; план лишь фиксирует
   техническую реализуемость.
7. **Стабильность id.** MangaDex — UUID (стабильны), фанатские сайты — слаги
   (могут меняться). Поэтому `external_id` хранится строкой, а `external_url`
   обновляется при каждом успешном резолве.

---

## 12. Этапы внедрения

| Этап | Что делаем | Результат | Оценка |
|---|---|---|---|
| **0. Замер** | Скрипт: 200 популярных тайтлов → сколько глав бесплатно на MangaDex / MangaLib / SelfManga / Yai | Реальные цифры покрытия, решение о приоритетах | 1 день |
| **1. Каркас** | `title_sources`, `source_health`, `types.ts`, `registry.ts`, `resolve.ts` | Слой источников без нового контента | 2 дня |
| **2. MangaDex** | Адаптер, маппинг по MAL, крон `link-manga-sources`, бейджи | +60–70% бесплатной манги | 2–3 дня |
| **3. Ранобэ + Флибуста** | Адаптер, крон `link-ranobe-flibusta`, кнопка «Читать том» | EPUB-тома для ранобэ | 1–2 дня |
| **4. Фанатские агрегаторы** | MangaLib → SelfManga → Yai/MintManga по одному, с health | +10–20% покрытия | 3–5 дней |
| **5. UI** | `SourceSwitcher`, `SourceBadge`, `ChapterSources`, `PaidLock` | Пользователь видит и выбирает источники | 2 дня |
| **6. Полировка** | Кэш, лимиты, admin-секции, метрики, документация | Наблюдаемость и устойчивость | 2 дня |

**Итого:** ~13–16 рабочих дней. Порядок можно менять; этап 0 обязателен.

**Рекомендуемый порядок:** 0 → 1 → 2 → 3 → 5 → 4 → 6. Сначала то, что даёт
больше всего контента и наименее хрупко (MangaDex), потом UI, потом парсеры.

---

## 13. Критерии готовности

- [ ] Этап 0 дал измеренные цифры покрытия и они записаны в документ.
- [ ] `title_key` используется вместо `shikimori_id` в новых таблицах.
- [ ] `title_sources` заполняется chunked-кроном без ручных правок.
- [ ] `canonical_chapters` и `chapter_sources` строятся автоматически.
- [ ] Карточка манги показывает главы из ≥2 источников, если они есть.
- [ ] Платная глава Remanga открывается бесплатно из MangaDex/агрегатора, если
      там есть.
- [ ] Если бесплатной версии нет — честная заглушка, без запроса страниц.
- [ ] Маршрут `/manga/read/[dir]/[idx]?source=` работает; старые ссылки
      редиректят.
- [ ] `locator` содержит `source`, `chapterKey`, `idx`; переключение источника
      не ломает «Продолжить».
- [ ] at-home MangaDex не кэшируется дольше 10 минут; картинки не битые.
- [ ] Allowlist прокси суффиксный; `*.mangadex.network` проходит.
- [ ] Ранобэ: кнопка «Читать том на Флибусте» открывает EPUB-ридер.
- [ ] `/admin/status` показывает health источников и счётчики маппинга.
- [ ] Выключение источника флагом не ломает остальные.
- [ ] `tsc`, `next lint`, `next build` проходят.
- [ ] Обновлены `README.md`, `MANGA.md`, `SESSION-REPORT.md`.

---

## 14. Карта новых и изменяемых файлов

```
src/lib/sources/
├── types.ts              NEW  контракт адаптера и нормализованные типы
├── chapterLabel.ts       NEW  клиентобезопасные подписи/нормализация номера
├── canonical.ts          NEW  нормализация и merge глав
├── registry.ts           NEW  реестр и приоритеты
├── resolve.ts            NEW  резолвер канонических глав и контента
├── health.ts             NEW  запись/чтение source_health
├── selectors.ts          NEW  селекторы для HTML-парсеров
├── mangadex.ts           NEW  адаптер MangaDex
├── mangalib.ts           NEW  адаптер MangaLib/cdnlibs
├── selfmanga.ts          NEW  адаптер SelfManga
├── yai.ts                NEW  адаптер Yai
├── mintmanga.ts          NEW  адаптер MintManga
├── flibustaRanobe.ts     NEW  адаптер Флибусты для ранобэ
├── remanga.ts            NEW  обёртка над существующим src/lib/manga.ts
└── renovels.ts           NEW  обёртка над существующим src/lib/ranobe.ts

src/components/sources/
├── SourceBadge.tsx       NEW
├── SourceSwitcher.tsx    NEW
├── ChapterSources.tsx    NEW
└── PaidLock.tsx          NEW

src/app/api/cron/
├── link-manga-sources/route.ts    NEW
└── link-ranobe-flibusta/route.ts  NEW

src/lib/manga.ts          EDIT  перевести на resolve.ts, не ломая текущее поведение
src/lib/ranobe.ts         EDIT  то же
src/components/manga/MangaReader.tsx    EDIT  source/chapterKey в прогрессе
src/components/ranobe/RanobeReader.tsx  EDIT  то же + кнопка EPUB
src/app/api/progress/route.ts           EDIT  принимать source/chapterKey в locator
src/lib/adminJobs.ts                    EDIT  новые джобы
src/app/admin/status/page.tsx           EDIT  секция «Источники»
src/lib/readingProgress.ts              EDIT  проброс source/chapterKey

supabase/migrations/
└── 0057_media_sources.sql        NEW  title_sources, canonical_chapters,
                                       chapter_sources, source_health,
                                       source_link_state
```

---

## 15. Что НЕ входит в план

- Покупка платных глав.
- Партнёрства и API-ключи правообладателей.
- Пользовательские загрузки (CBZ/EPUB) — запрещено условием.
- Обход авторизации и DRM. (Публичные JS-challenge — см. §23.3; это не
  авторизация и не пейвол.)
- Хранение страниц или файлов в БД/Storage.
- Raw-источники без перевода (точка расширения, не MVP).
- Telegram-бот-поиск (отдельная идея, вне сайта).
- Полнотекстовый поиск по картинкам.
- Офлайн-скачивание глав (отдельная тема, PWA).

---

## 16. Открытые вопросы

1. **Порог `confidence`** для показа источника: 0.7 или 0.8?
2. **MangaLib API** — использовать внутренний JSON или HTML-парсинг? (нужен
   замер на этапе 0)
3. **Приоритет источников**: Remanga → MangaDex или MangaDex → Remanga? (зависит
   от качества сканов и числа платных глав)
4. **Ранобэ-тома Флибусты**: показывать в «Продолжить» отдельной строкой или
   сливать с главой Renovels?
5. **Лимит прокси**: сколько МБ на главу допустимо до перехода на CDN?
6. **Юридическая политика**: включать ли все агрегаторы сразу или по одному, с
   возможностью быстрого отключения?

---

## 17. Быстрый старт (первые 3 шага)

1. **Замер**: скрипт `scripts/measure-coverage.ts` — 200 тайтлов из `manga_index`,
   проверить MangaDex/MangaLib/SelfManga, записать таблицу покрытия.
2. **Каркас**: миграция `0057`, `types.ts`, `chapterLabel.ts`, `canonical.ts`,
   `registry.ts`, `resolve.ts` с одним адаптером (`mangadex`).
3. **MangaDex end-to-end**: карточка → главы → страницы → прокси → прогресс →
   «Продолжить». После этого решать про парсеры по измеренным цифрам.

---

## 18. Расширенная карта «серых» методов

Ниже — методы, которые выходят за пределы «официальный API + лёгкий парсинг».
Все они работают с **публично доступным** контентом, но нарушают ToS сайтов,
поэтому включаются флагами и имеют kill-switch.

| № | Метод | Что даёт | Сложность | Стабильность | Риск |
|---|---|---|---|---|---|
| 1 | Эмуляция мобильных API приложений | Полные списки глав и страниц, иногда без авторизации | средняя | средняя | ToS |
| 2 | Массовый HTML-парсинг агрегаторов | Русские фан-переводы, вебтуны | низкая | низкая | ToS |
| 3 | Raw-источники + автоперевод | Контент, которого нет в RU | высокая | низкая | ToS + качество |
| 4 | Индексация публичных Telegram-каналов | Сливы платных глав файлами | средняя | низкая | ToS + DMCA |
| 5 | Обход блокировок и зеркал | Доступ к заблокированным, но публичным сайтам | средняя | высокая | ToS/юрисдикция |
| 6 | Архивы и кэши поисковиков | Восстановление мёртвых страниц | низкая | средняя | низкая |
| 7 | Filehoster-ссылки (free tier) | Файлы, выложенные бесплатно | средняя | низкая | ToS |
| — | **Чужие/слитые аккаунты, DRM, подделка покупок** | — | — | — | **не делаем**, см. §26 |

**Общее правило:** каждый метод — отдельный адаптер в `registry.ts`, отдельный
флаг `SOURCE_*`, отдельная строка в `source_health`. Отключение одного не
затрагивает остальные.

---

## 19. Эмуляция мобильных API официальных приложений

### 19.1. Идея

У Remanga и Renovels есть мобильные приложения. Их API часто шире веб-API:
отдаёт те же главы и страницы, но с другим набором заголовков, иногда без
жёсткой привязки к веб-сессии. Мы **не обходим авторизацию** — используем
только те эндпоинты, которые отвечают без токена (публичные), но с
«мобильными» заголовками.

### 19.2. Как исследовать (этап 0, вручную, один раз)

1. Поставить `mitmproxy` / HTTP Toolkit на Android-эмулятор.
2. Установить официальное приложение Remanga / Renovels.
3. Полистать каталог, открыть бесплатную главу.
4. Выписать:
   - обязательные заголовки (`User-Agent`, `X-Requested-With`, `Accept`,
     `X-API-Version`, app-version, device-id);
   - какие эндпоинты отвечают `200` **без** `Authorization`;
   - какие требуют токен → **не трогаем**.
5. Зафиксировать результат в `src/lib/sources/remangaMobile.ts` как константы.

### 19.3. Реализация адаптера

```typescript
// src/lib/sources/mobileClient.ts
export function mobileHeaders(source: 'remanga' | 'renovels') {
  const base = {
    'User-Agent': APP_UA[source],          // UA приложения, не браузера
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  // ВАЖНО: сюда НЕ кладём чужие Authorization/cookies.
  return base;
}

export async function fetchPublic(source: 'remanga' | 'renovels', path: string) {
  const res = await fetch(API_BASE[source] + path, {
    headers: mobileHeaders(source),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 || res.status === 403) {
    // Эндпоинт требует авторизацию → этот путь не используем.
    throw new SourceDeniedError(source, res.status);
  }
  return res;
}
```

### 19.4. Что это даёт и чего не даёт

- **Даёт:** иногда более полный список глав, чем веб-каталог; стабильные
  страницы бесплатных глав.
- **Не даёт:** платные главы. Если страницы отдаются только с токеном
  покупателя — это уже не «серый», а «чёрный» метод, и мы его не делаем.
- **Риск:** приложение могут обязать слать подписанные заголовки (HMAC,
  attestation). Тогда метод отключается флагом, без правок остального кода.

---

## 20. Массовый HTML-парсинг агрегаторов

### 20.1. Список целей (расширяется на этапе 0)

| Сайт | Движок | Что парсим |
|---|---|---|
| SelfManga | ReadManga-подобный | карточка, главы, страницы |
| MintManga | тот же | то же |
| MangaLib / cdnlibs | свой | карточка, главы, страницы |
| Yai | свой | карточка, главы, страницы |
| ReadManga | ReadManga-подобный | то же |
| Mangak / MangaHub / прочие | разное | по результатам замера |

### 20.2. Слои fetcher'а

```typescript
// src/lib/sources/fetchLayer.ts
interface FetchOptions {
  source: SourceId;
  url: string;
  cacheTtlMs?: number;
  useBrowser?: boolean;   // для JS/Cloudflare-страниц
}

export async function fetchPage(opts: FetchOptions): Promise<string> {
  // 1. Кэш (api_response_cache) → hit return.
  // 2. Ограничитель: не чаще 1 запроса / 500 мс на домен.
  // 3. Прямой fetch с обычными заголовками.
  // 4. Если 403/503/JS-challenge → useBrowser (см. §23.3).
  // 5. Ошибку не кэшируем.
}
```

### 20.3. Конфиг селекторов

Селекторы не разбросаны по коду — один файл, чтобы редизайн правился в одном
месте:

```typescript
// src/lib/sources/selectors.ts
export const SELECTORS = {
  selfmanga: {
    title:      'h1.manga-title, .manga-name',
    altTitles:  '.alt-names a',
    cover:      '.manga-cover img@src',
    chapterRow: '.chapters-link tr, .expand-chapters-item',
    chapterId:  'a@href',        // извлекаем id из URL
    chapterLabel: '.chapter-number',
    pageImage:  '.reader-image img@src',
  },
  // ... остальные
} as const;
```

Формат `селектор@атрибут` — чтобы не тащить лишние зависимости.

### 20.4. Парсер

```typescript
import * as cheerio from 'cheerio';

export function parseChapters(html: string, source: SourceId) {
  const $ = cheerio.load(html);
  const cfg = SELECTORS[source];
  return $(cfg.chapterRow).map((_, el) => ({
    chapterKey: extractId($(el).find(cfg.chapterId).attr('href')!),
    chapterLabel: $(el).find(cfg.chapterLabel).text().trim(),
  })).get();
}
```

### 20.5. Устойчивость

- Каждый парсер возвращает `null`, если не нашёл обязательный узел — а не
  бросает исключение в UI.
- `source_health`: `parse_ok=false, reason=selector_miss`.
- «Канареечные» тайтлы: 3 популярных названия на источник; крон раз в сутки
  проверяет, что парсятся. Если нет — источник помечается `degraded`, бейдж
  пропадает из UI.
- Кэш глав 6–24 ч, чтобы не дёргать HTML на каждый рендер.

### 20.6. Ограничения

- Парсинг нарушает ToS. Часть сайтов отдаёт `robots.txt` запрет на
  агрегаторов — такие источники **не включаем**.
- Сайты меняют вёрстку и включают анти-бот. Поэтому метод — вторичный.

---

## 21. Raw-источники и автоматический перевод

### 21.1. Схема

```
raw-сайт (японский/корейский/китайский скан)
   → адаптер raw (главы + страницы)
   → OCR (опционально) / перевод
   → нормализованные страницы → ридер
```

### 21.2. Варианты перевода

| Вариант | Плюсы | Минусы |
|---|---|---|
| Fan-перевод с агрегатора | Бесплатно, качественно | Не для всех тайтлов |
| Машинный перевод текста (DeepL/Google) | Покрывает всё | Дорого, качество низкое |
| OCR + машинный перевод | Для сканов без текста | Очень дорого, медленно |
| Наложение перевода (overlay) | Сохраняет оригинал | Сложный UI |

### 21.3. Почему это не в MVP

Стоимость перевода одной главы (20–40 страниц) машинно — центы, но при
тысячах глав это десятки/сотни долларов в месяц, плюс задержка и качество.
**Решение:** оставить точку расширения (`kind: 'raw'`), включать только для
конкретных тайтлов по запросу.

---

## 22. Индексация публичных Telegram-каналов

### 22.1. Что это

Публичные каналы с мангой/ранобэ публикуют файлы (`.cbz`, `.zip`, `.pdf`) и
ссылки на файлхостинги. Это публичный контент, но не сайт с API.

### 22.2. Архитектура (отдельный воркер, не в Next.js)

```
Telethon (MTProto, user-сессия)
   → список публичных каналов (конфиг)
   → чтение последних N сообщений
   → извлечение: название, том/глава, файл или ссылка
   → запись в search-индекс (Postgres FTS / trigram)
   → бот/страница поиска отдаёт deep link
```

```python
# worker/telegram_index.py (эскиз)
from telethon import TelegramClient

async def index_channel(client, channel: str, limit: int = 500):
    async for msg in client.iter_messages(channel, limit=limit):
        if msg.document or (msg.text and looks_like_file_link(msg.text)):
            yield {
                "channel": channel,
                "msg_id": msg.id,
                "title": extract_title(msg),
                "chapter": extract_chapter(msg),
                "file_name": getattr(msg.document, "attributes", None),
                "date": msg.date,
                "link": f"https://t.me/{channel}/{msg.id}",
            }
```

### 22.3. Интеграция с сайтом

- Сайт **не проксирует** файлы из Telegram.
- В карточке тайтла — блок «Найдено в Telegram» со ссылками `t.me/...`.
- Пользователь сам решает, открывать ли.
- Ссылки могут умирать (удалённые сообщения) — крон периодически чистит.

### 22.4. Ограничения

- Нужна user-сессия Telegram (номер телефона) — это персональный аккаунт;
  риск блокировки.
- Публичные каналы читаются, но перепубликация файлов на сайте — уже
  распространение. Поэтому только ссылки, не файлы.
- DMCA-риск выше, чем у Флибусты, потому что это прямой слив платного.
- **Статус:** опционально, вне основного плана.

---

## 23. Обход блокировок и зеркала

### 23.1. Зачем

Флибуста, часть агрегаторов и raw-сайтов заблокированы в РФ на уровне
провайдеров. Сервер вне РФ обычно достаёт их напрямую. Если сервер в РФ —
нужен обход.

### 23.2. Список зеркал и health-check

```typescript
const FLIBUSTA_MIRRORS = ['flibusta.is', 'flibusta.site', 'flibusta.club'];
// Крон раз в час: HEAD /opds → первый живой → активное зеркало
```

Для агрегаторов — аналогичные списки доменов. Активное зеркало пишется в
`source_health.meta`.

### 23.3. JS/Cloudflare-челленджи

Если сайт отдаёт challenge, а контент публичный:

```typescript
// Вариант A: FlareSolverr (внешний сервис)
const res = await fetch('http://flaresolverr:8191/v1', {
  method: 'POST',
  body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
});
// Вариант B: headless-браузер (camoufox/playwright) в отдельном контейнере
```

- Только для страниц, которые **и так видны любому посетителю** в браузере.
- Не для страниц за логином/пейволом.
- Кэшировать результат, чтобы не гонять браузер на каждый запрос.

### 23.4. Proxy pool

- Пул исходящих IP (datacenter + residential).
- Ротация при `403/429`.
- Счётчик ошибок на IP, временное исключение.
- **Не использовать** прокси для обхода авторизации.

### 23.5. DNS-over-HTTPS

Если провайдер подменяет DNS — `DoH` (`cloudflare-dns.com`, `dns.google`)
решает часть блокировок на уровне резолва.

---

## 24. Архивы и кэши поисковиков

Для мёртвых страниц/глав:

| Источник | Как использовать |
|---|---|
| Wayback Machine | `https://web.archive.org/web/2024/{url}` — отдаёт сохранённую HTML |
| archive.today | `https://archive.ph/newest/{url}` |
| Google/Yandex cache | через их кэш-ссылки (нестабильно) |

```typescript
async function fetchWithArchiveFallback(url: string) {
  const direct = await tryDirect(url);
  if (direct) return direct;
  const wayback = await tryWayback(url);   // CDX API: /cdx/search/cdx?url=...&output=json
  return wayback;
}
```

**Ограничения:** архивы не содержат картинок глав (только HTML), для манги
почти бесполезны. Полезны для карточек/описаний/списков глав.

---

## 25. Filehoster-ссылки (free tier)

Некоторые Telegram/форум-посты ведут на `MEGA`, `Google Drive`, `Yandex
Disk`, `Mediafire` и т. п.

| Сценарий | Делаем? |
|---|---|
| Файл лежит в свободном доступе, ссылка публичная | Да, отдаём ссылку |
| Нужен аккаунт файлохостинга | Нет |
| Нужен премиум для скачивания | **Нет** — это обход пейвола |
| Нужна капча | Нет автоматизации; отдаём ссылку пользователю |

Сайт **не хранит и не проксирует** эти файлы; максимум — резолвит публичную
ссылку и показывает её.

---

## 26. Граница: что не делаем и почему

Эти методы часто предлагают в «серых» обсуждениях, но они не «серые», а
«чёрные» — и операционно провальные:

| Метод | Почему нет |
|---|---|
| Чужие/слитые аккаунты Remanga/Renovels | Несанкционированный доступ; бан аккаунта и IP за часы; аккаунт-донор быстро умирает; юридический риск для владельца сайта |
| Пул «общих» аккаунтов / credential-sharing | То же + нарушение ToS платформы + утечка чужих данных |
| Подделка платёжных токенов / `is_bought=true` | Мошенничество; уголовная ответственность |
| Обход DRM (FairPlay, Webtoon DRM и т. п.) | Прямое нарушение закона об авторском праве |
| SQL-инъекции / дампы БД источников | Уголовное преступление |
| Скачивание платного через «взломанное» приложение | То же |
| Автоматический обход капчи для платного контента | Обход защиты; не делаем |

**Почему это важно не только этически:** такие схемы живут дни-недели, требуют
постоянного сопровождения, ставят под удар весь проект (домен, хостинг,
платёжку) и не дают стабильного UX. Архитектура, которая держится на
украденных токенах, не масштабируется.

**Правило проекта:** мы максимизируем **публично доступное** и честно
показываем замок там, где бесплатной версии нет.

---

## 27. Операционная инфраструктура для серых методов

### 27.1. Отдельные воркеры

Парсинг и обход блокировок не должны жить в основном Next.js-процессе:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Next.js app │────▶│ source-worker    │────▶│ внешние сайты │
│ (Vercel/VPS)│     │ (VPS, pm2/docker)│     │ (парсинг)     │
└─────────────┘     └──────────────────┘     └──────────────┘
        │                     │
        └────────┬────────────┘
                 ▼
           Postgres (индекс, health, кэш)
```

- Worker держит браузер, прокси-пул, очереди.
- App только читает нормализованные данные.
- Падение воркера не роняет сайт.

### 27.2. Очередь и лимиты

- Очередь задач (BullMQ/Redis или таблица `source_jobs`).
- Лимит на домен: 1 запрос / 500 мс.
- Глобальный семафор: N параллельных запросов.
- Таймаут на задачу, ретраи с backoff, dead-letter.

### 27.3. Kill-switch

```typescript
// Один флаг выключает источник во всех путях
if (!isSourceEnabled('mangalib')) return null;
```

Флаг читается из env + `source_health.enabled`. Админка может выключить
источник без деплоя.

### 27.4. Логи без PII

- Логируем `source`, `op`, `status`, `ms`, `count`.
- Не логируем cookies, токены, IP пользователей.
- Храним 7–14 дней.

### 27.5. Процедура реакции на жалобу

1. Приходит DMCA/жалоба → выключить источник/тайтл флагом.
2. Удалить маппинг из `title_sources` (не сами внешние файлы — их у нас нет).
3. Записать в журнал.
4. Уведомить владельца проекта.

Так как контент не хранится, «удаление» — это удаление ссылок/маппингов.

---

## 28. Этапы для серых методов (после базового плана)

| Этап | Метод | Оценка | Условие включения |
|---|---|---|---|
| S1 | Эмуляция мобильных API Remanga/Renovels | 1–2 дня | этап 0 показал, что публичные эндпоинты полезнее веб-API |
| S2 | MangaLib/cdnlibs адаптер | 2 дня | замер покрытия > 5% |
| S3 | SelfManga + MintManga (общий движок) | 2 дня | селекторы стабильны на канареечных тайтлах |
| S4 | Зеркала + health + DoH | 1 день | сервер в РФ или нестабильный доступ |
| S5 | FlareSolverr/headless для JS-сайтов | 2 дня | есть сайт с нужным контентом за challenge |
| S6 | Raw + автоперевод (пилот на 10 тайтлах) | 3–5 дней | есть бюджет на перевод и спрос |
| S7 | Telegram-индексация (отдельный воркер) | 3–5 дней | принято решение о риске; только публичные каналы |
| S8 | Архивный fallback | 0.5 дня | есть мёртвые страницы, которые нужны |

**Рекомендация:** S1 → S4 → S2 → S3. Остальное — по спросу и после замера
риска. S6/S7 не включать без отдельного решения владельца проекта.

---

## 29. Обновлённые критерии готовности (серые методы)

- [ ] Каждый серый источник — отдельный адаптер и флаг.
- [ ] Kill-switch выключает источник без деплоя.
- [ ] `source_health` показывает `last_ok_at`, `errors_24h`, `latency_ms`.
- [ ] Парсер при `selector_miss` не ломает UI и не кэширует ошибку.
- [ ] Прокси не является открытым релеем (whitelist хостов).
- [ ] Нет логирования cookies/токенов/IP.
- [ ] Есть процедура реакции на жалобу.
- [ ] Ни один путь не использует чужие аккаунты, DRM или подделку покупок.
- [ ] Документ `README.md` описывает, какие источники включены и как их
      отключить.

---

## 30. Статус реализации (ревизия 2)

### 30.1. Что уже в коде

| Файл | Что делает | Статус |
|---|---|---|
| `supabase/migrations/0057_media_sources.sql` | `title_sources`, `canonical_chapters`, `chapter_sources`, `source_health`, `source_link_state`, RLS | готово, применить вручную |
| `src/lib/sources/types.ts` | контракт адаптера и нормализованные типы | готово |
| `src/lib/sources/text.ts` | нормализация и сравнение названий | готово |
| `src/lib/sources/chapterLabel.ts` | номера глав, подписи, канонические ссылки | готово |
| `src/lib/sources/canonical.ts` | слияние глав в каноническую ось | готово |
| `src/lib/sources/health.ts` | env-флаги, `source_health`, kill-switch | готово |
| `src/lib/sources/mangadex.ts` | адаптер MangaDex (поиск, главы, at-home) | готово |
| `src/lib/sources/mangalib.ts` | адаптер MangaLib (cdnlibs API, Referer для картинок) | готово, проверено живьём |
| `src/lib/sources/readmangaEngine.ts` | общий адаптер движка ReadManga (SelfManga/MintManga) | готово, проверено живьём |
| `src/lib/sources/selfmanga.ts` | SelfManga (включён) | готово |
| `src/lib/sources/mintmanga.ts` | MintManga (выключен: 18+ требует логин) | готово, ограниченно |
| `src/lib/sources/remanga.ts` | обёртка над `src/lib/manga.ts` | готово |
| `src/lib/sources/renovels.ts` | обёртка над `src/lib/ranobe.ts` | готово |
| `src/lib/sources/flibustaRanobe.ts` | тома ранобэ (EPUB), `granularity='volume'` | готово |
| `src/lib/sources/registry.ts` | реестр и приоритеты | готово |
| `src/lib/sources/resolve.ts` | канонические главы, выбор источника, negative-cache | готово |
| `src/lib/sources/mangaView.ts` | канонические главы → `MangaChapter`/`MangaChapterContent` | готово |
| `src/components/sources/CanonicalBootstrap.tsx` | клиентский bootstrap маппинга (manga/ranobe) | готово |
| `src/app/manga/[dir]/page.tsx` | карточка: канонический режим + fallback + бейджи | готово |
| `src/app/manga/read/[dir]/[chapterId]/page.tsx` | читатель: idx/старый id, редирект, выбор источника | готово |
| `src/components/manga/MangaReader.tsx` | `source`/`chapterKey`/`idx`/`chapterNo`/`tome` в прогрессе | готово |
| `src/app/ranobe/[dir]/page.tsx` | кнопка «Читать томами» + bootstrap | готово |
| `src/app/api/cron/link-manga-sources/route.ts` | chunked-маппинг манги | готово |
| `src/app/api/cron/link-ranobe-flibusta/route.ts` | chunked-маппинг ранобэ → Флибуста | готово |
| `src/app/api/sources/resolve/route.ts` | ленивый резолвер для клиента | готово |
| `src/lib/adminJobs.ts` | джобы `link-manga-sources` / `link-ranobe-flibusta` | готово |
| `src/app/admin/status/page.tsx` | секция «Источники чтения» + прогресс маппинга | готово |
| `scripts/measure-coverage.mjs` | замер покрытия MangaDex/MangaLib/SelfManga | готово |
| `.env.example` | `SOURCE_*` флаги | готово |

Проверки: `npx tsc --noEmit`, `npx eslint` по новым файлам и `npm run build`
проходят.

### 30.2. Что ещё не сделано

1. Применить миграцию `0057` в рабочей БД.
2. Манга переведена на каноническую ось гибридно (готово). Ранобэ: кнопка
   «Читать томами» и крон `link-ranobe-flibusta` готовы; `RanobeReader`
   сознательно оставлен на Renovels — это единственный источник глав, и
   канонизация сейчас не даёт выигрыша. Когда появится второй источник глав
   (например, MangaLib), читатель переводится по той же схеме, что манга.
3. Агрегаторы: MangaLib и SelfManga готовы; MintManga — ограниченно (18+
   требует логин); Yai мёртв. Этап 4 закрыт.
4. Секция «Источники чтения» в `/admin/status` и джобы
   `link-manga-sources` / `link-ranobe-flibusta` в `adminJobs` — готовы.
5. `scripts/measure-coverage.mjs` — готово; запускать на `--limit=200` после
   применения индексов.
6. E2E-прогон: MangaDex-глава и том Флибусты под авторизованным
   пользователем.

### 30.3. Первый замер (сэмпл, 3 тайтла)

`node scripts/measure-coverage.mjs --limit=3 --no-db`

| Тайтл | MangaDex | MangaLib | SelfManga |
|---|---:|---:|---:|
| Магическая битва | 0 | 276 | нет |
| Соло Левелинг | 0 | 0 | нет |
| Клинок, рассекающий демонов | 226 | 240 | нет |

Выводы:

- MangaDex для лицензированных тайтлов часто отдаёт только `externalUrl`
  (MangaPlus) и `pages = 0` — это не наша бесплатная глава, замер их
  отбрасывает;
- MangaLib даёт полные RU-главы;
- SelfManga не содержит мейнстрим-лицензию, его вклад — ниша;
- приоритет для лицензированного мейнстрима: Remanga → MangaLib → MangaDex →
  SelfManga; для ниши — Remanga → MangaDex → SelfManga.

На реальном `manga_index` цифры будут другими: сэмпл — только проверка, что
замер работает.

**Гибридный режим манги (важно):** на первом открытии карточки канонического
оглавления ещё нет, поэтому показывается Remanga, а `CanonicalBootstrap`
запускает маппинг и делает `router.refresh()`. После этого карточка и читатель
переходят на `idx` и показывают бейджи источников. Если БД/источник недоступны,
сайт остаётся на старом пути.

---

**Итог:** план даёт максимум бесплатного контента в рамках твоей архитектуры:
MangaDex как основной источник, фанатские агрегаторы как расширение, Флибуста
как сильный путь для ранобэ. «Серые» методы (эмуляция публичных API, парсинг
агрегаторов, обход блокировок, архивы, публичные Telegram-каналы) расписаны с
архитектурой и kill-switch. Платные эксклюзивы остаются закрытыми — это
физическое ограничение источников, а не недоработка. Чужие аккаунты, DRM и
подделка покупок не используются: они не «серые», а «чёрные», и операционно
провальны. Никаких партнёрств, покупок и импорта.
