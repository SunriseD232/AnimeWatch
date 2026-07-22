/**
 * Минимальный клиент Telegram Bot API — только sendMessage, нужен для
 * отправки кода подтверждения при привязке аккаунта (см.
 * api/telegram/link/route.ts). Не связан с telegram-bot/ (отдельное VPS-
 * приложение) — это прямой вызов api.telegram.org с Vercel, для скачивания
 * видео телеграм-бот на VPS по-прежнему нужен отдельно.
 *
 * Выполняется ТОЛЬКО на сервере — BOT_TOKEN не должен попасть в браузер.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}
