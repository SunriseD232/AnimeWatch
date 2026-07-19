# MediaWatch — аниме, фильмы и сериалы с кросс-девайс синхронизацией

Веб-приложение для просмотра аниме из открытых источников. Главная фича:
позиция просмотра (**тайтл → серия → секунда**) сохраняется в облаке и
автоматически восстанавливается на любом устройстве после входа в аккаунт.

## Стек

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Supabase** — Postgres + Auth + Row Level Security + Realtime
- **Shikimori API** — каталог метаданных аниме
- **Kodik** — embed-плеер (iframe), поиск по `shikimori_id`
- Деплой: **Vercel** (фронт) + **Supabase Cloud** (данные)

Собственного Node-сервера нет: вся серверная логика — Next.js Route Handlers /
Server Components + Supabase.

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
3. **Authentication → Providers → Email**: включите Email. Для локальной
   разработки удобно отключить `Confirm email` (тогда вход сразу после
   регистрации); в проде оставьте подтверждение включённым.

## 2. Применение SQL-миграции

Откройте **SQL Editor** в Supabase и выполните содержимое файла
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

Миграция создаёт таблицы `watch_progress` и `user_list`, включает RLS с
политиками «пользователь видит только свои строки» и добавляет
`watch_progress` в публикацию Realtime.

> Через Supabase CLI: `supabase db push` (после `supabase link`).

## 3. Kodik-токен (опционально)

Токен Kodik бесплатный, но выдаётся по запросу
(<https://kodik.cc/> → раздел для разработчиков / поддержка).

- **Режим A (есть токен):** укажите `KODIK_TOKEN` в окружении — сервер
  проксирует поиск плеера (`/api/kodik`), становятся доступны выбор озвучки и
  список серий.
- **Режим B (нет токена):** приложение автоматически использует публичный
  `find-player`-iframe как fallback. Часть событий плеера и селектор озвучки
  могут быть недоступны.

Источник видео абстрагирован интерфейсом `VideoSource`
([`src/lib/video/types.ts`](src/lib/video/types.ts)) — замена провайдера не
затрагивает остальное приложение.

## 4. Переменные окружения

Файл `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
KODIK_TOKEN=            # опционально
```

## 5. Деплой на Vercel

1. Импортируйте репозиторий в Vercel.
2. В **Settings → Environment Variables** добавьте те же три переменные.
3. Deploy. Сборка (`next build`) не требует дополнительной настройки.
4. В Supabase **Authentication → URL Configuration** добавьте домен Vercel в
   `Site URL` / `Redirect URLs`.

## Структура

```
src/
  app/
    page.tsx                              главная: «Продолжить» + популярное
    search/page.tsx                       поиск по Shikimori
    anime/[shikimoriId]/page.tsx          страница тайтла
    watch/[shikimoriId]/[episode]/page.tsx страница просмотра (ядро)
    login, signup, profile                авторизация и профиль
    auth/signout/route.ts                 выход
    api/progress/route.ts                 upsert прогресса (в т.ч. sendBeacon)
    api/kodik/route.ts                    прокси поиска плеера Kodik (Режим A)
  components/                             UI-компоненты (Player, карточки, ...)
  lib/
    supabase/                             клиенты browser/server + middleware
    shikimori.ts                          клиент Shikimori API (throttle + cache)
    video/                                абстракция VideoSource + Kodik
    format.ts, types.ts
  middleware.ts                           обновление сессии + защита /profile
supabase/migrations/0001_init.sql
```

## Как работает синхронизация прогресса

1. Kodik-плеер шлёт события родительскому окну через `postMessage`
   (`kodik_player_time_update`, `..._pause`, `..._video_ended` и т.д.).
   Ключи вынесены в [`kodik-events.ts`](src/lib/video/kodik-events.ts).
2. Клиент ([`Player.tsx`](src/components/Player.tsx)) сохраняет позицию:
   каждые 10 сек во время воспроизведения, при паузе, а также при
   `beforeunload` / `visibilitychange(hidden)` — через
   `navigator.sendBeacon('/api/progress')`, чтобы флаш не терялся при закрытии
   вкладки.
3. Route Handler [`/api/progress`](src/app/api/progress/route.ts) делает upsert
   в `watch_progress` по `(user_id, shikimori_id)`. RLS гарантирует, что
   пользователь пишет только свои строки.
4. При открытии серии сервер читает прогресс и, если он для этой серии и
   позиция в допустимом диапазоне, передаёт `start_from` плееру и показывает
   тост «Вы остановились на …».
5. Supabase Realtime уведомляет другие открытые вкладки об изменениях
   (last-write-wins по `updated_at`).

## Критерии приёмки (сценарий)

Вход на ноутбуке → поиск → просмотр серии 3 до 14:32 → закрыть вкладку → вход
на телефоне под тем же аккаунтом → на главной карточка «Серия 3» → клик →
плеер открывается на серии 3 с ~14:32 (допуск ±15 сек).
