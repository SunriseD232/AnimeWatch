# MediaWatch Telegram Bot

Бот для скачивания видео из MediaWatch и отправки в Telegram.

## Поддерживаемые источники

| Источник | Метод извлечения | RAM |
|---|---|---|
| **AniLibria** | HTTP API (прямые HLS-ссылки) | ~0 |
| **Alloha** | YummyAnime API → Puppeteer → перехват .mp4/.m3u8 | ~200-400 MB (временно) |
| **Videoseed** | embed URL → Puppeteer → перехват .mp4/.m3u8 | ~200-400 MB (временно) |

## Архитектура

```
MediaWatch (Vercel)                    VPS
┌──────────────────────────┐          ┌──────────────────────────────────────┐
│ Кнопка «Скачать в TG»    │          │ Telegram Bot (Node.js/Telegraf)      │
│ POST /api/download       │   API    │   ↳ Supabase-очередь (polling)       │
│ → запись в Supabase:     │ ────────→│   ↳ Извлечение видео-URL             │
│   { tgId, source,        │          │   ↳ ffmpeg → скачивание              │
│     animeId, episode }   │          │   ↳ Local Bot API → sendVideo (2 ГБ) │
│                           │          │   ↳ fs.unlinkSync → удаление файла   │
│ Показывает статус        │ ←─────── │                                      │
└──────────────────────────┘          └──────────────────────────────────────┘
```

## Требования к VPS

- **CPU**: 1 core
- **RAM**: 1 GB (пик ~700 MB)
- **SSD**: 20 GB (временные файлы удаляются после отправки)
- **Docker + Docker Compose**

## Быстрый старт

### 1. Применить миграции Supabase

Выполните по очереди в SQL Editor Supabase:
`supabase/migrations/0006_download_queue.sql`, затем `0007_download_source.sql`.

### 2. Создать бота в Telegram

1. Напишите @BotFather → `/newbot` → получите токен
2. Получите `API_ID` и `API_HASH` на my.telegram.org

### 3. Настроить окружение

```bash
cp .env.example .env
# Заполните:
#   BOT_TOKEN               — от @BotFather
#   TELEGRAM_API_ID         — с my.telegram.org
#   TELEGRAM_API_HASH       — с my.telegram.org
#   NEXT_PUBLIC_SUPABASE_URL — из Supabase
#   SUPABASE_SERVICE_ROLE_KEY — service_role ключ Supabase
#   VIDEOSEED_TOKEN          — из проекта MediaWatch
#   VIDEOSEED_HOST           — из проекта MediaWatch
```

### 4. Запустить

```bash
docker compose up -d

# Проверить логи
# docker compose logs -f bot
```

## Как это работает

1. Пользователь вводит Telegram ID в профиле MediaWatch → MediaWatch (Vercel)
   сам шлёт код подтверждения через Bot API, бот на VPS для этого шага не
   нужен — только BOT_TOKEN должен быть и в env Vercel
2. На странице плеера (AniLibria / Alloha / Videoseed) появляется кнопка «Скачать в Telegram»
3. При нажатии → задача ставится в очередь Supabase (status: `pending`)
4. Бот забирает задачу, извлекает видео-URL, скачивает через ffmpeg
5. Отправляет видео через Local Bot API (до 2 ГБ на файл)
6. Удаляет временный файл

## Ограничения

- Concurrency: **1 задача за раз** (FIFO, FOR UPDATE SKIP LOCKED)
- Размер файла: макс. **1.5 GB** (защита от заполнения диска)
- Таймаут скачивания: **15 минут**
- Повторные попытки: **макс. 3** на битую ссылку
- Лимиты: **5 запросов/мин** с IP, **3 скачивания/день** на пользователя

## Структура

```
src/
  index.ts              — точка входа, Telegraf, polling очереди
  supabase.ts           — Supabase service-role клиент + типы
  queue.ts              — FIFO-очередь, concurrency=1, heartbeat 15 мин
  sender.ts             — ffmpeg + Local Bot API + удаление файла
  extractors/
    index.ts            — диспетчер по источнику
    anilibria.ts        — AniLibria (HTTP, прямая HLS)
    alloha.ts           — Alloha (Yummy + Puppeteer)
    videoseed.ts        — Videoseed (Puppeteer)
Dockerfile              — Alpine + Chromium + ffmpeg
docker-compose.yml      — бот + Local Bot API Server
.env.example            — переменные окружения
```
