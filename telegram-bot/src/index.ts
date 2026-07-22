import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { createServiceClient } from './supabase.js';
import { processQueue } from './queue.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан');
  process.exit(1);
}

const bot = new Telegraf(token, {
  // Если настроен Local Bot API Server — используем его (apiRoot живёт под
  // telegram.apiRoot, не на верхнем уровне опций — иначе Telegraf его молча
  // игнорирует и шлёт всё через обычный api.telegram.org с лимитом 50 МБ,
  // без ради чего вообще поднимался Local Bot API Server).
  ...(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH
    ? { telegram: { apiRoot: process.env.TELEGRAM_API_ROOT || 'http://localhost:8081' } }
    : {}),
});

// --- Команды бота ---

bot.start((ctx) => {
  return ctx.reply(
    '👋 Привет! Я бот MediaWatch.\n\n' +
    'Я отправляю видео, которые вы заказываете на сайте MediaWatch.\n' +
    'Чтобы привязать аккаунт:\n' +
    '1. Узнайте свой Telegram ID у @userinfobot\n' +
    '2. Введите его в настройках профиля на сайте MediaWatch\n' +
    '3. Подтвердите код\n\n' +
    'После этого на странице просмотра появится кнопка «Скачать в Telegram».'
  );
});

bot.help((ctx) => ctx.reply(
  'Команды:\n' +
  '/start — приветствие\n' +
  '/help — эта справка\n' +
  '/id — ваш Telegram ID (нужен для привязки)'
));

bot.command('id', (ctx) => {
  const id = ctx.from?.id;
  if (id) {
    return ctx.reply(`Ваш Telegram ID: \`${id}\``, { parse_mode: 'Markdown' });
  }
  return ctx.reply('Не удалось определить ID.');
});

console.log('Бот запущен');
bot.launch().catch((err) => {
  console.error('Ошибка запуска бота:', err);
  process.exit(1);
});

// --- Очередь скачивания ---

const supabase = createServiceClient();
let running = false;

async function pollQueue() {
  if (running) return;
  running = true;
  try {
    await processQueue(supabase, bot);
  } catch (err) {
    console.error('Ошибка очереди:', err);
  } finally {
    running = false;
  }
}

// Пинг каждые 5 секунд.
setInterval(pollQueue, 5_000);

// Graceful shutdown.
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
