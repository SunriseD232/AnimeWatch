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
    cinema/page.tsx           — главная кино
    cinema/[id]/              — страница тайтла кино
    cinema/watch/[id]/[season]/[episode]/ — просмотр кино (сезон — часть пути!)
    search/page.tsx           — поиск (аниме + кино раздельно)
    profile/page.tsx          — профиль + «Мой список» (вкладки Аниме/Кино)
    login/, signup/           — авторизация (email/password через Supabase Auth)
    api/kodik/route.ts        — прокси смены озвучки Kodik (без полной перезагрузки)
    api/progress/route.ts     — upsert прогресса просмотра (единая точка записи)
    api/cron/check-episodes/route.ts — суточный крон уведомлений о новых сериях
  components/                 — все React-компоненты (клиентские и серверные)
  lib/
    shikimori.ts               — клиент Shikimori API (каталог/поиск/похожее аниме)
    videoseed-catalog.ts        — каталог кино (apiv2.php Videoseed)
    kodik-catalog.ts            — МЁРТВЫЙ КОД, не импортируется нигде (см. §9)
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
  middleware.ts                 — Supabase-сессия + редирект «/» → последний открытый раздел
supabase/migrations/            — SQL-миграции, применяются вручную через Supabase SQL Editor
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
- **Ручное скачивание/извлечение сырого потока балансеров не реализовывалось
  и не будет** — так и осталось намеренным решением в проекте (обсуждалось
  и отклонялось явно): это выходит за рамки личного просмотра через legit
  embed-плееры с их рекламой/защитой.
- **Vercel Hobby-тариф ограничивает крон** раз в сутки — если тариф сменится
  на Pro, можно увеличить частоту проверки новых серий.

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

Без опциональных токенов соответствующие источники просто не появляются в
переключателе — сайт не падает.

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

## 12. Карты интерфейса — маршруты

```
/                                          — главная (аниме)
/popular?page=N                            — топ по рейтингу за год, пагинация
/anime/[shikimoriId]                       — страница тайтла аниме
/watch/[shikimoriId]/[episode]              — просмотр аниме
/cinema                                    — главная кино
/cinema/[id]                               — страница тайтла кино (id = kinopoisk_id)
/cinema/watch/[id]/[season]/[episode]      — просмотр кино
/search?q=&type=cinema                     — поиск (type опущен → аниме)
/profile                                   — профиль, «Мой список» (вкладки)
/login, /signup                            — авторизация
```
