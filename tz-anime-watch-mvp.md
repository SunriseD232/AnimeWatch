# ТЗ: AnimeWatch — MVP трекера просмотра аниме с кросс-девайс синхронизацией

## 1. Цель продукта

Веб-приложение для просмотра аниме из открытых источников с главной фичей: позиция просмотра (тайтл → серия → секунда) сохраняется в облаке и автоматически восстанавливается на любом устройстве после входа в аккаунт.

## 2. Стек (все сервисы — бесплатные тарифы)

- **Фронтенд:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Бэкенд/БД/Auth:** Supabase (Postgres + Supabase Auth + Row Level Security)
- **Каталог метаданных:** Shikimori API (https://shikimori.one/api/doc)
- **Видео:** Kodik embed-плеер (iframe), поиск embed по `shikimori_id`
- **Деплой:** Vercel (фронт), Supabase Cloud (данные)
- **Библиотеки:** `@supabase/supabase-js`, `@supabase/ssr`

Никакого собственного Node-сервера не требуется: серверная логика — только Next.js Route Handlers / Server Components + Supabase.

## 3. Роли и авторизация

- Анонимный пользователь: может искать и смотреть аниме, прогресс НЕ сохраняется (показывать ненавязчивый баннер «Войдите, чтобы синхронизировать прогресс»).
- Авторизованный пользователь: полный функционал.
- Auth через Supabase: email + пароль (magic link не обязателен в MVP). Использовать `@supabase/ssr` для сессий в cookies, чтобы работал SSR.

## 4. Структура БД (Supabase / Postgres)

```sql
-- Прогресс просмотра: одна строка на пару (пользователь, тайтл)
create table watch_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shikimori_id integer not null,
  anime_title text not null,          -- денормализация для быстрого рендера списка
  poster_url text,                    -- то же
  episode integer not null default 1,
  position_seconds numeric not null default 0,
  duration_seconds numeric,           -- для расчёта % просмотра
  translation_id integer,             -- id озвучки Kodik, чтобы восстанавливать её же
  updated_at timestamptz not null default now(),
  unique (user_id, shikimori_id)
);

-- Список «Смотрю / Запланировано / Просмотрено» (опционально, см. приоритеты)
create table user_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shikimori_id integer not null,
  status text not null check (status in ('watching','planned','completed','dropped')),
  created_at timestamptz not null default now(),
  unique (user_id, shikimori_id)
);

-- RLS: пользователь видит и меняет только свои строки
alter table watch_progress enable row level security;
alter table user_list enable row level security;

create policy "own progress select" on watch_progress for select using (auth.uid() = user_id);
create policy "own progress insert" on watch_progress for insert with check (auth.uid() = user_id);
create policy "own progress update" on watch_progress for update using (auth.uid() = user_id);
create policy "own progress delete" on watch_progress for delete using (auth.uid() = user_id);
-- аналогичные 4 политики для user_list

create index on watch_progress (user_id, updated_at desc);
```

## 5. Страницы и роутинг

```
/                     — главная: «Продолжить просмотр» + популярное с Shikimori
/search?q=...         — поиск по Shikimori
/anime/[shikimoriId]  — страница тайтла: инфо, список серий, кнопка «Продолжить»
/watch/[shikimoriId]/[episode] — страница просмотра с плеером
/login, /signup       — авторизация
/profile              — мой список, выход из аккаунта
```

### 5.1 Главная `/`
- Блок «Продолжить просмотр»: карточки из `watch_progress` (сортировка по `updated_at desc`, максимум 12), на карточке: постер, название, «Серия N», прогресс-бар (`position_seconds / duration_seconds`). Клик → `/watch/[id]/[episode]` с восстановлением позиции.
- Блок «Популярное сейчас»: GET `https://shikimori.one/api/animes?order=popularity&limit=18&status=ongoing`.
- Если не авторизован — вместо первого блока баннер с призывом войти.

### 5.2 Поиск `/search`
- Инпут с debounce 400 мс → GET `https://shikimori.one/api/animes?search={q}&limit=20`.
- Сетка карточек: постер (`https://shikimori.one` + `image.original`), русское название (`russian`), год, тип.

### 5.3 Страница тайтла `/anime/[shikimoriId]`
- GET `https://shikimori.one/api/animes/{id}` — название, описание (очистить bb-код Shikimori регуляркой или показать `description` как plain text), рейтинг, статус, число эпизодов (`episodes` или `episodes_aired` для онгоингов).
- Сетка кнопок серий 1..N. Серии ≤ текущей из `watch_progress` подсветить как просмотренные, текущую — акцентом.
- Кнопка «Продолжить с серии N (мм:сс)» если есть прогресс, иначе «Начать просмотр».
- Кнопка добавления в список (если реализуется `user_list`).

### 5.4 Страница просмотра `/watch/[shikimoriId]/[episode]` — ядро продукта

**Получение плеера Kodik:**
- Kodik отдаёт embed-ссылки через свой поисковый API: `https://kodikapi.com/search?token={KODIK_TOKEN}&shikimori_id={id}&with_episodes=true`. Токен бесплатный, но выдаётся по запросу; ПРЕДУСМОТРЕТЬ два режима:
  - **Режим A (есть токен):** серверный Route Handler `/api/kodik?shikimoriId=...` проксирует запрос (токен только на сервере, в env), возвращает link плеера, список серий и озвучек.
  - **Режим B (нет токена, fallback):** конструировать iframe напрямую вида `//kodik.info/find-player?shikimoriID={id}&episode={ep}` — если такой публичный вариант недоступен, показать заглушку с инструкцией добавить токен. Код написать так, чтобы источник видео был абстрагирован интерфейсом `VideoSource { getEmbedUrl(shikimoriId, episode, translationId?) }` — тогда замена провайдера не трогает остальное приложение.
- iframe: `allowfullscreen`, адаптивный контейнер 16:9.

**Трекинг позиции через postMessage (ключевая логика):**
- Kodik-плеер шлёт события родительскому окну через `window.postMessage`. Подписаться:

```ts
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (typeof e.data !== 'object' || !e.data?.key) return;
    switch (e.data.key) {
      case 'kodik_player_time_update':      // { value: секунды }
        currentTimeRef.current = e.data.value; break;
      case 'kodik_player_duration_update':  // { value: секунды }
        durationRef.current = e.data.value; break;
      case 'kodik_player_video_started':
      case 'kodik_player_play': setPlaying(true); break;
      case 'kodik_player_pause': setPlaying(false); flushProgress(); break;
      case 'kodik_player_video_ended': onEpisodeEnded(); break;
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);
```

- Названия событий сверить с актуальной документацией Kodik в момент реализации; вынести их в константы.

**Сохранение прогресса:**
- Каждые 10 сек во время воспроизведения (setInterval, активен только при `playing === true`) + при паузе + при `beforeunload` / `visibilitychange(hidden)` → upsert в `watch_progress` по `(user_id, shikimori_id)`.
- Не сохранять, если позиция < 5 сек (случайное открытие).
- Если позиция > 90% длительности — при следующем открытии предлагать следующую серию.

**Восстановление позиции:**
- При загрузке страницы прочитать прогресс. Если он для этой серии и позиция в диапазоне 5%–90% — передать стартовое время плееру. У Kodik стартовая позиция задаётся параметром iframe-ссылки (`?start_from={seconds}` — сверить название параметра с документацией). Если параметр не сработает — показать тост «Вы остановились на 14:32» без автоперемотки.
- Если у пользователя прогресс на ДРУГОЙ серии этого тайтла — показать баннер «Вы остановились на серии N — перейти?».

**Реалтайм-синхронизация между устройствами (nice to have):**
- Supabase Realtime подписка на изменения своей строки `watch_progress`; если `updated_at` пришёл новее локального и вкладка на паузе/скрыта — обновить состояние. Конфликт решается правилом «последняя запись побеждает» (last-write-wins по `updated_at`).

**Прочее на странице:**
- Селектор озвучки (из ответа Kodik API, режим A), выбор сохранять в `translation_id`.
- Кнопки «← Пред. серия» / «След. серия →», список серий сбоку/снизу.
- По событию `video_ended`: автопометка серии просмотренной (upsert `episode = ep + 1, position_seconds = 0`) и кнопка «Следующая серия» (без автоплея в MVP).

### 5.5 Профиль `/profile`
- Email, кнопка выхода.
- Список из `user_list` с фильтрами по статусу (если реализован).

## 6. Работа с Shikimori API — требования

- Все запросы к Shikimori делать с сервера (Server Components / Route Handlers), с заголовком `User-Agent: AnimeWatch MVP` — API это требует.
- Уважать rate limit: 5 rps / 90 rpm. Обернуть fetch в простой троттлер + кэшировать ответы (`next: { revalidate: 3600 }` для карточек тайтлов, 300 для поиска).
- Картинки: пути относительные, префикс `https://shikimori.one`. Добавить домен в `next.config.js → images.remotePatterns`.

## 7. Переменные окружения

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
KODIK_TOKEN=            # опционально, режим A
```

Создать `.env.example` с этим списком.

## 8. Нефункциональные требования

- TypeScript strict, без `any` в бизнес-логике.
- Мобильная адаптивность обязательна (основной сценарий — телефон/планшет).
- Тёмная тема по умолчанию (стандарт для видеосервисов).
- Скелетоны при загрузке, обработка ошибок API (тост/заглушка, не белый экран).
- Никаких платных сервисов; проект должен подниматься локально командами `npm i && npm run dev` при заполненном `.env.local`.
- README с инструкцией: создание проекта Supabase, применение SQL-миграции (файл `supabase/migrations/0001_init.sql`), получение Kodik-токена, деплой на Vercel.

## 9. Приоритеты (порядок реализации)

1. **P0:** каркас Next.js + Supabase Auth (регистрация/вход/выход, middleware защиты).
2. **P0:** SQL-миграция, поиск и страница тайтла через Shikimori.
3. **P0:** страница просмотра с Kodik iframe (абстракция `VideoSource`).
4. **P0:** сохранение/восстановление прогресса + блок «Продолжить просмотр» на главной. ← главная фича, довести до идеала.
5. **P1:** селектор озвучки, пред./след. серия, автопометка просмотренного.
6. **P1:** `user_list` со статусами.
7. **P2:** Supabase Realtime синхронизация вживую между открытыми устройствами.

## 10. Критерии приёмки MVP

- Сценарий: вход на ноутбуке → поиск тайтла → просмотр серии 3 до 14:32 → закрыть вкладку → вход на телефоне под тем же аккаунтом → на главной карточка тайтла «Серия 3» → клик → плеер открывается на серии 3 с позиции ~14:32 (допуск ±15 сек).
- Прогресс не теряется при закрытии вкладки без паузы (beforeunload-флаш работает).
- Неавторизованный пользователь может искать и смотреть, видит баннер про вход.
- Проект деплоится на Vercel без ошибок сборки.
