# MediaWatch — техническая документация проекта

Этот файл — полная техническая картина проекта: архитектура, схема БД,
протоколы всех видеобалансеров (включая факты, установленные экспериментально,
а не по документации — у большинства из них официальной документации нет),
известные ограничения и незакрытые вопросы. Пишется как самодостаточный
источник для переноса контекста в другую сессию/модель.

Для быстрого старта (установка, .env) см. [README.md](README.md).

---

## 1. Что это за проект

Веб-сайт для просмотра **аниме** и **фильмов/сериалов** с кросс-девайс
синхронизацией позиции просмотра (тайтл → сезон → серия → секунда,
сохраняется в облаке и восстанавливается на любом устройстве после входа).

Сайт **сам не хостит видео** — встраивает чужие видеобалансеры (iframe-плееры
сторонних сервисов) по токенам/API, аналогично тому, как это делают многие
легальные агрегаторы. У каждого балансера свой уровень интеграции — от
точного трекинга позиции через `postMessage` до банальной вставки iframe.

## 2. Стек

- **Next.js 14** (App Router, Server Components) + **TypeScript** + **Tailwind CSS 3.4**
- **Supabase** — Postgres + Auth + Row Level Security + Realtime
- **Vercel** — хостинг + Cron Jobs (без отдельного Node-сервера)
- Внешние источники контента: **Shikimori** (метаданные аниме), **AniLibria**
  (прямой HLS-поток для аниме), **Videoseed** (каталог + плеер кино),
  **Vibix**, **Kodik**, **YummyAnime** — балансеры/плееры
- Шрифт — **Inter** (`next/font/google`, self-hosted)

## 3. Структура каталогов

```
src/
  app/                        — роуты (App Router)
    page.tsx                  — главная (аниме): Продолжить / Лучшее из недавнего / Популярное
    popular/page.tsx          — полная пагинированная страница «Популярное»
    anime/[shikimoriId]/      — страница тайтла аниме
    watch/[shikimoriId]/[episode]/ — просмотр аниме
    cinema/page.tsx           — главная кино (+ вкладки категорий, см. §7.1)
    cinema/[id]/              — страница тайтла кино
    cinema/category/[id]/     — категория кино целиком, пагинация (?page=N)
    cinema/watch/[id]/[season]/[episode]/ — просмотр кино (сезон — часть пути!)
    search/page.tsx           — поиск (аниме + кино раздельно)
    profile/page.tsx          — профиль + «Мой список» (вкладки Аниме/Кино) + TelegramSettings
    login/, signup/           — авторизация (email/password через Supabase Auth)
    api/kodik/route.ts        — прокси смены озвучки Kodik (без полной перезагрузки)
    api/progress/route.ts     — upsert прогресса просмотра (единая точка записи)
    api/cron/check-episodes/route.ts — суточный крон уведомлений о новых сериях
    api/download/route.ts     — постановка задачи в очередь скачивания Telegram (см. §12)
    api/telegram/link/route.ts — привязка Telegram ID (код через Bot API, см. §12.6)
  components/                 — все React-компоненты (клиентские и серверные)
  lib/
    shikimori.ts               — клиент Shikimori API (каталог/поиск/похожее аниме)
    videoseed-catalog.ts        — каталог кино (apiv2.php Videoseed) + категории (§7.1)
    kodik-catalog.ts            — МЁРТВЫЙ КОД, не импортируется нигде (см. §9)
    tmdb.ts                      — клиент TMDB, только рейтинг для категорий кино
    telegram.ts                  — sendMessage через Bot API (код верификации, §12.6)
    anilibria.ts                 — клиент AniLibria (выполняется В БРАУЗЕРЕ, не на сервере!)
    format.ts, types.ts
    video/
      types.ts                  — общий интерфейс VideoSource
      kodik.ts, kodik-events.ts — Kodik-балансер + протокол его postMessage
      videoseed.ts               — билдер embed-URL Videoseed
      vibix.ts                   — клиент API Vibix
      yummy.ts                   — клиент API YummyAnime
    supabase/
      client.ts    — браузерный клиент (anon key)
      server.ts    — серверный клиент для Server Components (cookies-based сессия)
      middleware.ts — обновление сессии в middleware
      service.ts   — service_role клиент (обходит RLS; ТОЛЬКО для крона)
  hooks/
    useProgressSaver.ts         — общая логика сохранения прогресса (HLS/Kodik)
    useVideoseedEstimator.ts    — эвристический трекер позиции для Videoseed
    useTelegramLink.ts          — получение привязанного tgId (для DownloadButton)
  middleware.ts                 — Supabase-сессия + редирект «/» → последний открытый раздел
supabase/migrations/            — SQL-миграции, применяются вручную через Supabase SQL Editor
telegram-bot/                   — отдельное Node-приложение на VPS, см. §12. ИСКЛЮЧЕНО из
                                   корневого tsconfig.json (свои зависимости/tsconfig) — не
                                   удалять exclude, иначе `next build` падает на чужих импортах.
vercel.json                     — расписание крона
```

## 4. Схема данных (Supabase Postgres)

Миграции применяются **вручную** (нет CI-автоприменения) — новую миграцию
нужно самостоятельно выполнить в Supabase SQL Editor после того, как код
задеплоен.

### `watch_progress` (0001, 0002, 0003)
Одна строка на пару (пользователь, тайтл). Позиция просмотра для UI
«Продолжить просмотр» и восстановления при открытии серии.

```
user_id, content_type ('anime'|'cinema'), shikimori_id (для cinema — kinopoisk_id!),
anime_title, poster_url, season (default 1), episode,
position_seconds, duration_seconds, translation_id, updated_at
unique (user_id, content_type, shikimori_id)
```

⚠️ Колонка называется `shikimori_id` даже для кино (исторически) — там в ней
лежит **kinopoisk_id**. Не переименовано намеренно, чтобы не трогать рабочий
путь аниме.

### `user_list` (0001, 0002)
Пользовательский список: `watching | planned | completed | dropped`.
`unique (user_id, content_type, shikimori_id)`.

### `watched_episodes` (0004)
Точная пометка каждой досмотренной серии (для подсветки в сетке серий и
автоперевода тайтла в «Просмотрено» по окончании последней серии).
`unique (user_id, content_type, shikimori_id, season, episode)`.

### `episode_notifications` + `title_episode_baseline` (0005)
Уведомления о новых сериях (см. §8). Первая таблица — персональная (RLS),
вторая — глобальный кэш, полностью закрыта от клиентов (RLS без единой
policy — доступна только через `service_role`).

Все таблицы — RLS `auth.uid() = user_id` на select/update/delete. **Insert
через клиента запрещён** там, где строки должен создавать только сервер
(`episode_notifications` — только крон; остальные — через клиентский upsert
под RLS, это нормально).

### `download_queue`, `telegram_links`, `telegram_verifications` (0006, 0007)
Очередь скачивания в Telegram и привязка аккаунта — полная схема и описание
флоу в §12.3/§12.6, здесь не дублируется. RLS: пользователь видит только
свои строки; `telegram_verifications`/`download_queue` доступны боту на VPS
через `service_role` (обходит RLS, как и крон).

## 5. Прогресс просмотра — общая архитектура

Единая точка записи — `POST /api/progress` (`src/app/api/progress/route.ts`).
Принимает несколько режимов через один и тот же endpoint:

- **Обычная запись** — `position_seconds`, `duration_seconds`, `translation_id`.
  Отбрасывает записи с `position_seconds < 5` (случайные открытия).
- **`mark: true`** — отметить серию открытой БЕЗ точной позиции (для
  источников без трекинга — Videoseed, Alloha/Sibnet/Aksor через Yummy).
  Не перезаписывает уже сохранённую точную позицию той же серии.
- **`watched_episode: true`** — записать серию в `watched_episodes` (upsert,
  `ignoreDuplicates`).
- **`completed: true`** — перевести тайтл в `user_list` со статусом
  `completed`.

Клиентский хук `useProgressSaver` (`src/hooks/useProgressSaver.ts`) —
общая логика для HLS/Kodik-подобных источников: сохраняет каждые 10 сек во
время воспроизведения + на `beforeunload`/`visibilitychange` (через
`sendBeacon`, чтобы не терять данные при закрытии вкладки).

Realtime-синхронизация между устройствами: подписка на `postgres_changes`
таблицы `watch_progress`, тост «на другом устройстве вы перешли на серию X»
(показывается только когда вкладка неактивна/на паузе, чтобы не сбивать
активный просмотр).

## 6. Видеоисточники — аниме

Оркестратор — `src/components/WatchPlayer.tsx`. Три источника, переключатель
показывает только реально доступные для конкретной серии:

### AniLibria (приоритет по умолчанию, если найден)
- **Выполняется в браузере**, не на сервере (`src/lib/anilibria.ts`) —
  намеренно, чтобы поток шёл с гео-привязкой по IP пользователя.
- Внешних id (Shikimori/MAL) в их API нет → сопоставление тайтла эвристикой
  по названию (ромадзи + русское) + год, порог строгий (`score >= 80`),
  лучше не найти, чем сыграть чужой тайтл.
- Отдаёт **прямые HLS-ссылки** (1080/720/480p) → рендерится через `hls.js` в
  собственном `<video>` (`HlsPlayer.tsx`). Единственный источник с полным
  контролем над плеером: точный `timeupdate`, кнопка «Пропустить
  опенинг/эндинг» (тайминги — из YummyAnime, см. ниже), качество без
  перезагрузки страницы.

### Kodik (второстепенный/резервный)
- Серверный поиск по `shikimori_id` (kodik-api.com/search) — точный, не
  эвристика.
- Протокол `postMessage` **документирован и надёжен** —
  `src/lib/video/kodik-events.ts`: `kodik_player_time_update`,
  `kodik_player_duration_update`, `kodik_player_play/pause/video_started/
  video_ended`, `kodik_player_current_episode` (смена серии внутри плеера).
- Восстановление позиции — параметр `start_from` в query embed-URL.
  **Подтверждено экспериментально** (см. §7), что этот параметр
  обрабатывается **на сервере Kodik**, а не в клиентском JS — при статическом
  анализе бандла плеера строка `start_from` не встречается, что раньше
  привело к ложному выводу о неработоспособности параметра. Реальная
  проверка: сравнение HTML-ответа с разными значениями параметра — сервер
  вставляет `parsedStartFrom = parseStartfrom("N")` в разметку.

### YummyAnime (третий, опциональный)
- `src/lib/video/yummy.ts`, публичный API без токена, сервер `api.yani.tv`.
- Точный матчинг по `?shikimori_ids=` (батч, без обрезки).
- `/anime/{id}/videos` отдаёт **не поток**, а `iframe_url` на другие
  балансеры (Kodik/Alloha/Sibnet/Aksor) — на выборке ~57% строк это
  `kodikplayer.com`. Дедупликация по `iframe_url` (Alloha отдаёт несколько
  «озвучек» под одним и тем же iframe — выбор внутри их плеера).
- Трекинг: если выбранная строка — Kodik-эмбед, включается тот же протокол
  `KODIK_EVENTS` + `start_from` для резюма. Если нет (Alloha/Sibnet/Aksor) —
  **точный трекинг невозможен**: проверено эмпирически (скачаны все JS-бандлы
  плеера Alloha, ~1 МБ суммарно, — **ноль** упоминаний `postMessage`/
  `MessageEvent`), только `mark: true`. Alloha требует `Referer` со своего
  домена (`yani.tv`) — иначе отдаёт страницу-заглушку (обычная
  хотлинк-защита, не связана с трекингом).
- Также источник **skip-таймингов** опенинга/эндинга для AniLibria-плеера
  (`skips.opening/ending`, приоритет — строка с озвучкой «AniLibria», она
  точнее всего совпадает по монтажу с нашим HLS-потоком) и **постеров**
  лучшего качества, чем у Shikimori (см. §7).

## 7. Видеоисточники — кино (фильмы и сериалы)

Оркестратор — `src/components/Player.tsx` (отдельный от `WatchPlayer.tsx`,
не переиспользуется). Три источника по приоритету:

### Vibix (по умолчанию — единственный с полным точным трекингом)
- `src/lib/video/vibix.ts`. REST `https://vibix.org/api/v1/publisher/
  videos/kp/{kpId}`, `Authorization: Bearer $VIBIX_TOKEN` (формат токена
  `id|секрет`, приватный, только сервер).
- `iframe_url` в ответе **пустой** — встройка через их SDK: тег
  `<ins data-publisher-id data-type data-id [data-season] [data-episodes]>`
  + скрипт `graphicslab.io/sdk/v2/rendex-sdk.min.js`, который сам создаёт
  iframe (`VibixPlayer.tsx`).
- Протокол `postMessage` **реальный, но НЕ соответствует их же официальной
  sync-библиотеке** (проверено логом): плоский нативный формат Playerjs
  `{event, time, data, duration}`, а не `{type:'playerEvent', ...}`, который
  описан в их sync-lib.js. `time` летит ~4 раза/сек. Origin iframe —
  `*.kinescopecdn.net`. Команда возврата позиции — нативный Playerjs
  `{api:'seek', set:N}` (дублируем и `{type:'playerCommand', ...}` про
  запас). Важно: плеер сам восстанавливает СВОЮ локальную позицию ДО события
  `started` — наш seek из БД шлётся именно на `started`/`play`, не раньше,
  иначе он будет перебит их собственным резюмом.

### Videoseed (второй; каталог + плеер)
- Плеер: `src/lib/video/videoseed.ts`, embed_auto по kinopoisk_id
  (`VIDEOSEED_TOKEN`). Каталог (список/поиск/карточка): `src/lib/
  videoseed-catalog.ts`, apiv2.php (`VIDEOSEED_API_TOKEN` — **другой** ключ,
  «Ключ API», не «Ключ API плеера»).
- **Ключевой факт**: их Playerjs 22.0.1 — с **ВЫКЛЮЧЕННОЙ** опцией «Plugins /
  API / postMessage for iframe» (проверено эмпирически: 0 сообщений в window
  при play/pause/seek). Точная позиция физически недоступна.
- Вместо неё — эвристический оценщик `src/hooks/useVideoseedEstimator.ts`:
  ловит клики внутрь iframe через `window.blur` + `document.activeElement`,
  учитывает fullscreen, копит время таймером, потолки по длительности.
  Резюм — с буфером −15 сек (лучше начать чуть раньше, чем позже).
  Диагностика: `localStorage['aw:debugPlayer'] = '1'` → логи `[player msg]`.
- Пользователь писал в поддержку Videoseed (Telegram @Doznet) с просьбой
  включить postMessage — если включат, оценщик можно заменить точными
  событиями.

### Kodik (третий, резервный)
Тот же клиент/протокол, что и в разделе аниме (`src/lib/video/kodik.ts`,
`kodik-events.ts`), поиск по `kinopoisk_id` вместо `shikimori_id`.

### Сезоны
`videoseed-catalog.ts` парсит `seasons[]` из ответа Videoseed
(`{season, episodes}`). Роут — `/cinema/watch/[id]/[season]/[episode]`
(сезон — часть пути, не query-параметр). Переход между сериями умеет
пересекать границу сезона (последняя серия сезона → первая серия
следующего).

### 7.1. Категории кино (главная `/cinema`, `/cinema/category/[id]`)

У Videoseed НЕТ рабочей серверной фильтрации/сортировки каталога —
параметры `categories`/`category`/`genre`/`country` либо отдают HTTP 500,
либо принимаются, но реально ничего не фильтруют, `sort_by` тоже не
работает (наблюдался фактически алфавитный порядок вместо `post_date desc`).
Проверено вживую. Поэтому категории (`CINEMA_CATEGORIES` в
`src/lib/videoseed-catalog.ts`) реализованы ЦЕЛИКОМ на нашей стороне поверх
обычных `list=movie`/`list=serial`: фильтр по текстовым полям `genre`/
`country` (через запятую, кириллица) в каждой записи.

`getCinemaByCategory(categoryId, page, pageSize)` дозапрашивает страницы
апстрима (`from=`) и копит совпадения, пока не наберётся нужное число —
потолок `MAX_UPSTREAM_PAGES=30` защищает от лавины запросов на редкий жанр
при глубокой пагинации; каждая страница апстрима кэшируется через
`next.revalidate`, повторный доступ бесплатный.

Две категории (`foreign-series`, `ru-series`) дополнительно:
- `recentOnly` — жёсткий фильтр «текущий или прошлый год» (по `year`);
- `rankByRating` — сортировка по рейтингу TMDB (`src/lib/tmdb.ts`, поиск по
  `id_imdb`, т.к. у Videoseed своего рейтинга нет вообще). Без
  `TMDB_API_KEY` сортировка — no-op, порядок как есть. Пул кандидатов для
  сортировки на первой странице расширен до `RATING_CANDIDATE_POOL=120` —
  иначе сортировка просто переставляла бы первые ~25 попавшихся записей.

UI: чипы категорий на `/cinema` (превью по 12) + `/cinema/category/[id]`
(полная пагинация по 24, зеркалирует `/popular`).

## 8. Уведомления о новых сериях

Крон `src/app/api/cron/check-episodes/route.ts`, расписание в `vercel.json`
(`0 6 * * *`, раз в сутки — сознательно, из-за ограничения частоты крона на
Vercel Hobby-тарифе).

Логика: для каждого уникального тайтла в статусе `watching` у кого-либо —
текущее число серий (`getAnime`+`episodeCount` для аниме, `getCinemaById`
для кино — переиспользование существующих функций каталогов, новых внешних
интеграций не потребовалось) сравнивается с `title_episode_baseline`. При
росте — уведомление **всем**, кто смотрит этот тайтл (не только тому, кто
инициировал проверку). Первая встреча тайтла — молчаливый посев baseline,
без уведомления (иначе старые серии считались бы «новыми» задним числом).

Защита эндпоинта — заголовок `Authorization: Bearer $CRON_SECRET` (Vercel
сам его добавляет к cron-запросам, если задать `CRON_SECRET` в env).

Требует `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/supabase/service.ts`) — крону
нужно читать `user_list` **всех** пользователей, обычный клиент под RLS
этого не может.

`NotificationBell.tsx` в шапке — initial-список сервером (Navbar уже async
Server Component), дальше Realtime-подписка на `INSERT`. Mark read —
напрямую с клиента (`supabase.from('episode_notifications').update()`,
работает под RLS, без отдельного API route).

## 9. Известные ограничения / технический долг

- **`src/lib/kodik-catalog.ts` — мёртвый код.** Каталог кино переехал на
  Videoseed (у него в разы больше сериалов), этот файл больше нигде не
  импортируется. Можно удалить.
- **Позиция на Videoseed — оценка, не факт.** См. §7. Пользователь может
  дождаться ответа их поддержки — тогда оценщик заменяется точными событиями.
- **Alloha/Sibnet/Aksor (через Yummy) — трекинг невозможен.** Подтверждено
  экспериментально для Alloha (нет postMessage в принципе), для Sibnet/Aksor
  не проверялось (малая доля выдачи, ~10% и ~5% соответственно).
- **Кросс-источниковый перенос позиции неполный.** Для аниме `HlsPlayer` ↔
  `KodikPlayer` переносят живую позицию через `bumpPosition`/`livePositionRef`
  при ручном переключении внутри сессии. `YummyPlayer` в этот перенос не
  включён — только резюм из БД при новой загрузке страницы.
- **Ручное скачивание реализовано для Telegram-бота** — см. §12. Alloha и
  Videoseed извлекаются через Puppeteer (reverse-engineering embed-плееров),
  AniLibria — через прямой HTTP API. Это работает в отдельном боте на VPS,
  не в основном MediaWatch на Vercel.
- **Vercel Hobby-тариф ограничивает крон** раз в сутки — если тариф сменится
  на Pro, можно увеличить частоту проверки новых серий.
- **`telegram-bot/` обязан быть в `exclude` корневого `tsconfig.json`.**
  Это отдельный Node-проект со своими зависимостями (`puppeteer`, `telegraf`),
  не установленными в корневом `node_modules`. Без exclude `next build`
  падает на чужих импортах в ту же секунду, когда `telegram-bot/` попадает в
  git (уже случалось — см. коммит с этим фиксом). Аналогично у
  `telegram-bot/` должен быть СВОЙ `.gitignore` (`node_modules/`, `dist/`,
  `.env`) — корневой `.gitignore` игнорирует `node_modules` только в корне
  (`/node_modules`, с якорем), не рекурсивно.

## 10. Переменные окружения (полный список)

См. актуальный `.env.example` в корне — там же комментарии, откуда каждое
значение брать. Кратко:

| Переменная | Обязательна | Назначение |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | да | Supabase клиент |
| `SUPABASE_SERVICE_ROLE_KEY` | для крона | обход RLS в `check-episodes` |
| `CRON_SECRET` | для крона | защита `/api/cron/check-episodes` |
| `KODIK_TOKEN` | опционально | резервный плеер кино+аниме |
| `VIDEOSEED_TOKEN` | опционально | плеер кино (embed) |
| `VIDEOSEED_API_TOKEN` | опционально | каталог кино (apiv2.php) — **другой ключ** |
| `VIDEOSEED_HOST` | опционально | домен Videoseed, если отличается от дефолтного |
| `VIBIX_TOKEN` | опционально | плеер кино с точным трекингом |
| `TMDB_API_KEY` | опционально | рейтинг для категорий кино с `rankByRating` (§7.1) |
| `BOT_TOKEN` | для привязки Telegram | **нужен и на Vercel** — `api/telegram/link` шлёт код верификации напрямую через Bot API (§12.6); тот же токен нужен и боту на VPS |

Без опциональных токенов соответствующие источники просто не появляются в
переключателе — сайт не падает. Переменные `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`,
`SUPABASE_SERVICE_ROLE_KEY` (дубль), `VIDEOSEED_TOKEN`/`VIDEOSEED_HOST` (дубль) —
только для бота на VPS, см. §12 и `telegram-bot/.env.example`.

## 11. Дизайн-система

Палитра и типографика заданы централизованно в `tailwind.config.ts` +
`globals.css` — почти весь визуальный эффект достигается правкой токенов,
без переписывания разметки компонентов (у проекта была последовательная
система классов `bg-*`/`accent-*` ещё до этого).

- `bg.DEFAULT` `#000000`, `bg.card` `#1d1d1f` (оттенок apple.com dark-секций)
- `accent` `#2997ff` / hover `#47a9ff` (синий Apple для dark mode)
- Шрифт — Inter (`next/font/google`) → `-apple-system` как fallback
- Утилиты: `.press` (тактильное сжатие кнопок), `.glass` (матовое стекло
  тулбара/меню), `.card-lift` (подъём + свечение карточек при наведении)
- `rounded-2xl` на карточках/панелях, `rounded-full` на CTA и
  сегментированных переключателях
- `future.hoverOnlyWhenSupported: true` в Tailwind config — официальный флаг,
  чинит требование двойного тапа на мобильном (hover не эмулируется тапом)

## 12. Telegram Bot — скачивание видео

### 12.1. Общая архитектура

Telegram-бот — отдельное приложение, работающее на VPS (1 CPU, 1 GB RAM, 20 GB SSD).
Не имеет отношения к Vercel-хостингу MediaWatch.

```
MediaWatch (Vercel)                    VPS
┌──────────────────────────┐          ┌──────────────────────────────────────┐
│ Кнопка «Скачать в TG»    │          │ Telegram Bot (Node.js/Telegraf)      │
│ POST /api/download       │   API    │   ↳ Supabase-очередь (polling)       │
│ → запись в Supabase:     │ ────────→│   ↳ Извлечение видео-URL:            │
│   { tgId, source,        │          │     • AniLibria  → HTTP API          │
│     animeId, episode }   │          │     • Alloha     → Puppeteer         │
│                           │          │     • Videoseed  → Puppeteer         │
│ Показывает статус        │          │   ↳ ffmpeg → скачивание              │
│ «Скачивается / Готов»    │ ←─────── │   ↳ Local Bot API → sendVideo (2 ГБ) │
└──────────────────────────┘          │   ↳ fs.unlinkSync → удаление файла   │
                                      └──────────────────────────────────────┘
```

### 12.2. Ограничения VPS и их решение

| Ограничение | Решение |
|---|---|
| **1 GB RAM** | Concurrency = 1; Puppeteer с `--single-process --no-zygote`; ffmpeg с `-preset ultrafast` |
| **20 GB SSD** | Временные файлы удаляются сразу после отправки; макс. размер 1.5 GB |
| **1 CPU** | Sequential очередь; одно скачивание за раз |
| **Много пользователей** | Очередь FIFO через `FOR UPDATE SKIP LOCKED` |

### 12.3. Очередь скачивания

Таблица `download_queue` в Supabase:

```sql
create table download_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  tg_id       text not null,
  anime_id    text not null,
  episode     int not null,
  season      int default 1,
  source      text not null check (source in ('anilibria','alloha','videoseed')),
  content_type text not null default 'anime' check (content_type in ('anime','cinema')),
  anime_title text,
  poster_url  text,
  status      text not null default 'pending',
              check (status in ('pending','extracting','downloading','sending','completed','failed')),
  error       text,
  file_id     text,
  retry_count int default 0,
  created_at  timestamptz default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
```

Атомарный захват задачи — SQL-функция `claim_download_task()`:
- `FOR UPDATE SKIP LOCKED` — гарантирует, что два экземпляра бота не схватят одну задачу
- `retry_count < 3` — не больше 3 попыток на битую ссылку
- Heartbeat: задачи в `processing` дольше 15 минут сбрасываются в `pending` —
  реализовано в JS (`telegram-bot/src/queue.ts`), не в самой SQL-функции.

⚠️ Колонка `source` (`'anilibria'|'alloha'|'videoseed'` — то, что пользователь
реально смотрел в плеере) добавлена отдельной миграцией `0007_download_source.sql`
поверх основной таблицы из `0006`. Бот качает строго из указанного source, без
подмены на другой источник; фолбэк AniLibria→Alloha остаётся только для
задач без source (созданных до 0007).

### 12.4. Извлечение видео-URL по источникам

#### AniLibria (HTTP, без браузера)
- Shikimori API → romaji/russian/year → AniLibria API (поиск релиза) → AniLibria API (список серий) → `hls_720`
- **RAM**: ~0 (только HTTP-запрос)

#### Alloha (Puppeteer)
- YummyAnime API → `iframe_url` (Alloha-embed) → Puppeteer (Referer: `yani.tv`) → перехват `.mp4`/`.m3u8`
- **RAM**: ~200-400 MB на время работы Puppeteer (1-5 сек)

#### Videoseed (Puppeteer)
- `buildEmbedUrl(kpId, token, season, episode)` → Puppeteer (Referer: videoseed_host) → перехват `.mp4`/`.m3u8`
- **RAM**: ~200-400 MB на время работы Puppeteer (1-5 сек)

### 12.5. Скачивание и отправка

- `ffmpeg -i <video_url> -c copy -movflags +faststart /tmp/mediawatch_<id>.mp4`
- Таймаут: 15 минут
- Проверка размера: макс. 1.5 GB (защита от заполнения диска)
- Отправка через Local Bot API Server (MTProto, до 2 ГБ на файл)
- После отправки: `fs.unlinkSync` — немедленное удаление временного файла

### 12.6. Привязка Telegram ID

- Пользователь вводит Telegram ID в настройках профиля (`TelegramSettings.tsx`)
- `POST /api/telegram/link` генерирует код, пишет его в `telegram_verifications`
  (`status: 'pending'`) и **сразу шлёт его через Telegram Bot API напрямую с
  Vercel** (`src/lib/telegram.ts` → `sendMessage`, требует `BOT_TOKEN` в
  окружении Vercel — см. §10). Код в HTTP-ответ не попадает.
- Если отправка не удалась (обычно — пользователь ещё не писал боту `/start`,
  Telegram не позволяет ботам писать первыми) — запись удаляется, клиент
  получает `telegram_send_failed`.
- При успехе статус верификации становится `'sent'`.
- Пользователь вводит код на сайте → `PUT /api/telegram/link` проверяет
  `code`+`telegram_id`+статус ∈ {`sent`,`pending`}+не истёк → привязка
  upsert в `telegram_links` (Supabase, RLS).
- Это НЕ требует запущенного бота на VPS — привязка аккаунта работает
  независимо от скачивания видео (тот же `BOT_TOKEN`, но прямой HTTP-вызов
  из Vercel, а не через очередь/polling, как download_queue).

### 12.7. Rate limiting

- **5 запросов/мин** на `/api/download` с одного IP — in-memory sliding
  window в самом route-модуле. На serverless Vercel это best-effort: лимит
  живёт в рамках одного тёплого инстанса функции и сбрасывается на cold
  start/при другом инстансе, не строгая гарантия, но первая линия защиты.
- **3 скачивания/день** на пользователя — строгая проверка по БД
  (`count(download_queue) where user_id=... and created_at > now()-24h`),
  не считает повторные проверки статуса уже стоящей в очереди задачи.

### 12.8. Хостинг (Docker Compose)

```yaml
services:
  bot:
    build: ./telegram-bot
    env_file: .env
    depends_on:
      - local-bot-api
    restart: unless-stopped

  local-bot-api:
    image: aiogram/bot-api:latest
    environment:
      TELEGRAM_TOKEN: ${BOT_TOKEN}
      TELEGRAM_API_ID: ${API_ID}
      TELEGRAM_API_HASH: ${API_HASH}
      TELEGRAM_LOCAL: 1
    ports:
      - "8081:8081"
    volumes:
      - bot-api-data:/var/lib/telegram-bot-api
    restart: unless-stopped

volumes:
  bot-api-data:
```

**Оценка RAM**: Local Bot API ~250 MB + бот ~50 MB + Puppeteer ~400 MB (временно) = **~700 MB пик**.

### 12.9. Структура бота

```
telegram-bot/
  src/
    index.ts              — точка входа, Telegraf, polling очереди
    supabase.ts           — Supabase service-role клиент + тип DownloadTask
    queue.ts              — FIFO-очередь, concurrency=1, heartbeat
    sender.ts             — ffmpeg + Local Bot API + удаление файла
    extractors/
      index.ts            — диспетчер по источнику
      anilibria.ts        — прямая HLS-ссылка через AniLibria API
      alloha.ts           — YummyAnime API → Puppeteer → перехват потока
      videoseed.ts        — embed URL → Puppeteer → перехват потока
  Dockerfile              — Alpine + Chromium + ffmpeg
  docker-compose.yml      — бот + Local Bot API Server
  .env.example            — переменные окружения
  package.json
  tsconfig.json
```

## 13. Карты интерфейса — маршруты

```
/                                          — главная (аниме)
/popular?page=N                            — топ по рейтингу за год, пагинация
/anime/[shikimoriId]                       — страница тайтла аниме
/watch/[shikimoriId]/[episode]              — просмотр аниме
/cinema                                    — главная кино (чипы категорий, §7.1)
/cinema/[id]                               — страница тайтла кино (id = kinopoisk_id)
/cinema/category/[id]                      — категория кино целиком, ?page=N
/cinema/watch/[id]/[season]/[episode]      — просмотр кино
/search?q=&type=cinema                     — поиск (type опущен → аниме)
/profile                                   — профиль, «Мой список» (вкладки)
/login, /signup                            — авторизация
```
