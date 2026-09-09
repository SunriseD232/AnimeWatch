# MediaWatch — аниме, фильмы и сериалы с кросс-девайс синхронизацией

Веб-приложение для просмотра аниме и фильмов/сериалов из открытых источников.
Главная фича: позиция просмотра (**тайтл → сезон → серия → секунда**)
сохраняется в облаке и автоматически восстанавливается на любом устройстве
после входа в аккаунт.

Сайт сам не хостит видео — встраивает сторонние видеобалансеры либо
проксирует поток через собственный плеер (см. ниже).

## Стек

- **Next.js 14** (App Router, Server Components) + **TypeScript** + **Tailwind CSS**
- **Supabase** — Postgres + Auth + Row Level Security + Realtime
- **Самостоятельный хостинг на VPS** — standalone-сборка Next.js под PM2
  (`output: 'standalone'` в `next.config.js`, деплой — `scripts/deploy.sh`)
- **Capacitor 8** — iOS-обёртка (`ios/`, `capacitor.config.ts`, сборка в `codemagic.yaml`)
- **Sentry** — мониторинг ошибок (опционально)
- Воспроизведение: **hls.js** / **dashjs**
- Метаданные: **Shikimori** (аниме), **TMDB** и **Videoseed API v2** (кино)
- Балансеры/плееры: **Kodik**, **Videoseed**, **Vibix**, **AniLibria**,
  **YummyAnime**, **Alloha**

Вся серверная логика сайта — Next.js Route Handlers / Server Components +
Supabase, отдельного бэкенда нет. Рядом на VPS живёт независимый сервис
`vps-extractor/` (см. «Собственный плеер»).

Требуется **Node 22.x** (см. `engines` в `package.json`).

## Быстрый старт локально

```bash
npm install
cp .env.example .env.local   # заполните значениями (см. ниже)
npm run dev                  # http://localhost:3000
```

## 1. Проект Supabase

1. Создайте проект на <https://supabase.com> (бесплатный тариф).
2. **Project Settings → API** → скопируйте:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` ключ → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` ключ → `SUPABASE_SERVICE_ROLE_KEY` (секретный, нужен
     регистрации и крону)
3. **Authentication → Providers → Email**: включите Email. Для локальной
   разработки удобно отключить `Confirm email` (тогда вход сразу после
   регистрации); в проде оставьте подтверждение включённым.

## 2. Применение SQL-миграций

Откройте **SQL Editor** в Supabase и выполните файлы из
[`supabase/migrations/`](supabase/migrations/) **по порядку номеров**
(`0001_init.sql` … `0025_anime_index.sql`) — одной первой миграции
недостаточно, схема набиралась инкрементально.

`0001_init.sql` создаёт таблицы `watch_progress` и `user_list`, включает RLS с
политиками «пользователь видит только свои строки» и добавляет
`watch_progress` в публикацию Realtime. Дальше добавляются
`watched_episodes`, `episode_notifications`, `title_episode_baseline`,
`system_notifications`, `resolved_streams`, `subtitle_cache`, `app_settings`,
`api_response_cache`, `user_presence`, `user_theme`, `anime_index` и правки к ним.

> Через Supabase CLI: `supabase db push` (после `supabase link`).

## 3. Kodik-токен (опционально)

Токен Kodik бесплатный, но выдаётся по запросу
(<https://kodik.cc/> → раздел для разработчиков / поддержка).

- **Режим A (есть токен):** укажите `KODIK_TOKEN` в окружении — сервер
  проксирует поиск плеера (`/api/kodik`), становятся доступны выбор озвучки и
  список серий. Тот же токен используется как один из каталогов раздела
  «Фильмы и сериалы».
- **Режим B (нет токена):** приложение автоматически использует публичный
  `find-player`-iframe как fallback. Часть событий плеера и селектор озвучки
  могут быть недоступны.

Вкладка «Kodik» убрана из переключателя плеера по умолчанию и остаётся
запасным вариантом, если ничего другого не резолвнулось. Вернуть её как
обычную вкладку можно живым флагом в профиле (админ, без редеплоя — см.
`src/components/KodikPlayerToggle.tsx`, `src/lib/settings.ts`, миграция 0013).

Источник видео абстрагирован интерфейсом `VideoSource`
([`src/lib/video/types.ts`](src/lib/video/types.ts)) — замена провайдера не
затрагивает остальное приложение.

## 4. Переменные окружения

Полный список с комментариями по каждой переменной —
[`.env.example`](.env.example), это источник истины. Минимум для запуска
(`.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # регистрация (/api/signup) и крон
SIGNUP_CODE_SECRET=...          # обязательно, см. §6 — без него регистрация закрыта
```

Дополнительно по разделам:

- Кино: `VIDEOSEED_TOKEN`, `VIDEOSEED_API_TOKEN`, `VIBIX_TOKEN`, `TMDB_API_KEY`
- Аниме: `KODIK_TOKEN` (опционально, см. §3)
- Собственный плеер: `PROXY_SIGNING_SECRET`, `VPS_EXTRACTOR_URL`,
  `VPS_EXTRACTOR_TOKEN`
- Крон уведомлений: `CRON_SECRET`
- Субтитры: `OPENSUBTITLES_API_KEY`
- Мониторинг: `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_ORG` / `SENTRY_PROJECT` /
  `SENTRY_AUTH_TOKEN` для сорсмапов)
- Self-host за reverse-proxy: `SITE_URL`

## Собственный плеер

«Наш плеер» стримит видео напрямую с сайта: прямая ссылка у эмбед-плеера
источника (Alloha/Videoseed и др.) извлекается **отдельным VPS-сервисом**
([`vps-extractor/`](vps-extractor/README.md) — обычный Puppeteer на VPS),
результат кэшируется в `resolved_streams` на 15 минут, а приложение проксирует
байты Range-кусками в `<video>`.

Серверное извлечение внутри Vercel serverless (`@sparticuz/chromium`) и
вариант с клиентским зеркалом эмбеда антибот источников не проходят — обе
попытки сняты, история в `ARCHITECTURE.md` §12.5–12.6.

Нужны `PROXY_SIGNING_SECRET` (подпись внутренних URL сегментов HLS — без него
`/api/proxy/raw` отклоняет все запросы, чтобы не стать открытым SSRF-прокси) и
`VPS_EXTRACTOR_URL` / `VPS_EXTRACTOR_TOKEN`. Подробности — `ARCHITECTURE.md` §12.

## 5. Деплой

CI/CD нет: пуш в `origin/main` сам по себе сайт **не** обновляет. Деплой —
вручную по SSH на продакшен-VPS, из корня проекта:

```bash
bash scripts/deploy.sh
```

Скрипт делает `git pull` → `npm ci` → `npm run build`, копирует `public/` и
`.next/static` внутрь `.next/standalone` (в standalone-режиме Next.js этого
не делает сам — без этого шага сайт поднимается, но весь CSS/JS отдаёт 404),
докладывает нативный бинарник `node-wreq` и перезапускает PM2-процесс
`mediawatch-web`. Подробности — комментарии в самом
[`scripts/deploy.sh`](scripts/deploy.sh).

Прочее:

- Переменные окружения — в `.env` на сервере (см. `.env.example`).
- В Supabase **Authentication → URL Configuration** добавьте домен сайта в
  `Site URL` / `Redirect URLs`.
- Крон уведомлений о новых сериях (`/api/cron/check-episodes`, ежедневно в
  06:00 UTC) описан в [`vercel.json`](vercel.json) — расписание оттуда
  осталось со времён Vercel; на VPS вызов нужно завести системным
  планировщиком, передавая заголовок `Authorization: Bearer $CRON_SECRET`
  (без `CRON_SECRET` эндпоинт не отличит планировщик от постороннего запроса).
- `vps-extractor/` разворачивается отдельно — см. его
  [README](vps-extractor/README.md).

## 6. Код регистрации (обязательно)

Сайт закрыт для незарегистрированных полностью — вся регистрация идёт
через один код на сутки, без учётной записи ничего не открыть.

1. Сгенерируйте случайную строку для `SIGNUP_CODE_SECRET`, например:
   `openssl rand -hex 32`.
2. Код на сегодня смотрится на `/code` — доступно ТОЛЬКО одному аккаунту
   (см. `src/app/code/page.tsx`, если email нужно сменить — правьте
   константу там).
3. **Обязательный ручной шаг в Supabase**: Dashboard → Authentication →
   Settings → отключите «Allow new users to sign up». Без этого обычная
   публичная регистрация Supabase всё ещё доступна напрямую через anon key
   в обход кода приглашения — подробности в `ARCHITECTURE.md` §14.2.

## Локальный индекс каталога аниме

Каталог фильтрует не через Shikimori, а по своей копии — таблицы
`anime_index` и `anime_genres` (миграция 0025, чтение —
[`src/lib/animeIndexQuery.ts`](src/lib/animeIndexQuery.ts)). Так фильтр по
жанрам, числу серий, году, рейтингу, типу и статусу становится одним
SQL-запросом.

Зачем: у Shikimori жанров нет в списочном ответе, поэтому AND и исключение
шли догрузкой полных карточек по одной с потолком в 120 штук; фильтра по
числу серий в API v1 нет вовсе; а список жанров из REST `/genres` — легаси
из 46 записей, где «Магия» есть, но не находит ничего (MAL растворил её во
«Фэнтези» и «Махо-сёдзё»). В актуальной таксономии 80 пунктов: 22 жанра,
53 темы, 5 демографий.

Обновление — полная перезакачка с нуля раз в сутки:
`/api/cron/reindex-anime` (заголовок `Authorization: Bearer $CRON_SECRET`),
на сервере в 02:00 UTC, то есть 05:00 по Москве. ~480 страниц по 50 тайтлов
из GraphQL Shikimori, около шести минут; ещё столько же занимает лёгкий
проход за рангами популярности (само поле GraphQL не отдаёт, только
сортировать умеет).

Живая таблица при этом не опустошается: закачка пишет строки со своим
`batch_id`, и указатель `anime_index_state.active_batch` переключается
только после того, как она целиком удалась и прошла проверку на усадку.
Оборвалась — читатели продолжают видеть прошлую партию. Если индекса нет
совсем, каталог откатывается на прежний путь через Shikimori.

### Локальный индекс каталога кино

То же самое для раздела «Фильмы и сериалы» (миграция `0027`,
`lib/cinemaIndex.ts`, чтение — `lib/cinemaIndexQuery.ts`).

Зачем: Videoseed не умеет фильтровать и сортировать ВООБЩЕ — параметры
`year=`, `genre_id=`, `sort_by=` он молча игнорирует (проверено: `total` не
меняется, порядок тот же). Прежний каталог поэтому тянул до 30 его страниц
на каждый клик, отбирал подстрокой по строке жанров (`genre.includes('Драма')`)
и сортировал пул из 120 записей — ни года, ни страны, ни рейтинга по всей
базе, ни честной пагинации так не сделать. Вдобавок это жгло квоту чужого
API на пользовательском трафике.

Обновление — полная перезакачка раз в сутки: `/api/cron/reindex-cinema`,
на сервере в 02:20 UTC (05:20 МСК). 207 запросов по 500 записей (82 455
фильмов + 20 969 сериалов), около семи минут, ~4% суточной квоты Videoseed.
В индекс попадает ~93 тысячи тайтлов: записи без `kinopoisk_id` отсеиваются
(по ним не построить ни плеер, ни прогресс), дубли по нему же схлопываются.

Справочники жанров и стран строятся из самих данных. Сопоставлять id с
названием ПО ПОЗИЦИИ нельзя: названия апстрим отдаёт по алфавиту, id — по
возрастанию, и порядки расходятся (Вестерн=4 идёт раньше Военный=3). Словарь
выводится пересечением множеств по всем записям, выборка набирается отдельно
по фильмам и по сериалам — маркеры «Сериалы»/«Мультсериалы» у фильмов не
встречаются в принципе.

Рейтинги TMDB живут в отдельной таблице `cinema_ratings`, которая
перестройку переживает, и обновляются своим кроном раз в неделю:
`/api/cron/refresh-cinema-ratings`, воскресенье 01:00 UTC (04:00 МСК).
Причина — TMDB не отдаёт рейтинги пачкой: один запрос на тайтл, 93 тысячи
тайтлов, и всё через VLESS-туннель (`api.themoviedb.org` с VPS заблокирован
по DNS). Прогон ограничен бюджетом запросов (`?limit=`, по умолчанию 40 000),
свежие рейтинги доезжают до выдачи следующей ночью, когда перестройка
скопирует их в партию.

## Оформление

Палитра задана CSS-переменными (`--accent`, `--bg`, `--bg-soft`, `--bg-card`)
с дефолтами в [`globals.css`](src/app/globals.css); `tailwind.config.ts`
ссылается на них, а не хранит цвета. По умолчанию — синий Apple `#2997ff` и
чёрный холст.

Пользователь меняет оформление в **профиле → «Оформление»**: акцент
(произвольный HEX или пресет) и одна из трёх тёмных фоновых тем. Выбор
хранится в таблице `user_theme` (миграция 0024) и подхватывается на других
устройствах; `localStorage` — зеркало, чтобы тема применялась до первой
отрисовки без мигания. Светлой темы нет: интерфейс построен на светлом тексте
поверх тёмного холста. Детали — [`src/lib/theme.ts`](src/lib/theme.ts) и
`ARCHITECTURE.md` §11.

## Структура

```
src/
  app/
    page.tsx                              главная (аниме): «Продолжить» + плитки
    popular/, new/, catalog/              популярное / новинки / каталог аниме
    anime/[shikimoriId]/                  страница тайтла аниме
    watch/[shikimoriId]/[episode]/        просмотр аниме (ядро)
    cinema/                               зеркальный раздел кино (сезон в пути)
    search/, calendar/, tips/             поиск, календарь выхода серий, подсказки
    login/, signup/, profile/, admin/     авторизация, профиль, админ-панель
    code/                                 код регистрации (§6)
    auth/signout/route.ts                 выход
    api/progress/                         upsert прогресса (+ /sync для офлайна)
    api/watch/anime|cinema/               данные страницы просмотра
    api/kodik/, api/trailer/, api/search/ прокси внешних источников
    api/theme/                            персональная тема оформления
    api/proxy/                            собственный плеер: резолв + Range-прокси,
                                          subtitles, dash-seg, raw
    api/cron/check-episodes/              суточный крон уведомлений
    api/cron/reindex-anime/               суточная перестройка индекса аниме
    api/cron/reindex-cinema/              суточная перестройка индекса кино
    api/cron/refresh-cinema-ratings/      недельное обновление рейтингов TMDB
    api/admin/, api/presence/, api/health/, api/client-log/
  components/                             UI (Player, OwnPlayer, HlsPlayer, карточки…)
  hooks/
    useProgressSaver.ts                   сохранение прогресса (HLS/Kodik/OwnPlayer)
    useVideoseedEstimator.ts              эвристический трекер позиции для Videoseed
  lib/
    supabase/                             клиенты browser/server + middleware
    shikimori.ts, tmdb.ts                 метаданные аниме / кино
    video/                                абстракция VideoSource + провайдеры
    theme.ts                              палитра: пресеты, CSS-переменные
    animeIndex.ts, animeIndexQuery.ts     локальный индекс каталога: сбор и чтение
    extract/                              резолв ссылок, Range-прокси, клиент VPS
    subtitles/, watch/, cache/, net/      субтитры, логика просмотра, кэш, сеть
  native/                                 Capacitor: офлайн-загрузки, внешний экран
  middleware.ts                           обновление сессии + auth-gate
supabase/migrations/                      0001 … 0025
vps-extractor/                            VPS-сервис извлечения (Puppeteer)
```

## Как работает синхронизация прогресса

1. Плеер сообщает позицию: Kodik — через `postMessage`
   (`kodik_player_time_update`, `..._pause`, `..._video_ended`; ключи в
   [`kodik-events.ts`](src/lib/video/kodik-events.ts)), собственный плеер и
   HLS — напрямую из событий `<video>`.
2. Клиент ([`Player.tsx`](src/components/Player.tsx),
   [`useProgressSaver.ts`](src/hooks/useProgressSaver.ts)) сохраняет позицию:
   каждые 10 сек во время воспроизведения, при паузе, а также при
   `beforeunload` / `visibilitychange(hidden)` — через
   `navigator.sendBeacon('/api/progress')`, чтобы флаш не терялся при закрытии
   вкладки.
3. Route Handler [`/api/progress`](src/app/api/progress/route.ts) делает upsert
   в `watch_progress` по `(user_id, content_type, shikimori_id)` и отмечает
   досмотренную серию в `watched_episodes`. RLS гарантирует, что пользователь
   пишет только свои строки.
4. При открытии серии сервер читает прогресс и, если он для этой серии и
   позиция в допустимом диапазоне, передаёт `start_from` плееру и показывает
   тост «Вы остановились на …».
5. Supabase Realtime уведомляет другие открытые вкладки об изменениях
   (last-write-wins по `updated_at`).

## Критерии приёмки (сценарий)

Вход на ноутбуке → поиск → просмотр серии 3 до 14:32 → закрыть вкладку → вход
на телефоне под тем же аккаунтом → на главной карточка «Серия 3» → клик →
плеер открывается на серии 3 с ~14:32 (допуск ±15 сек).
