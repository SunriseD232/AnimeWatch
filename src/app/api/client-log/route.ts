import { NextResponse, type NextRequest } from 'next/server';
import { getCachedUser } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const IP_LIMIT = 60;
const IP_WINDOW_MS = 60_000;
// Только буквы/цифры/._: — иначе клиент мог бы воткнуть перевод строки в
// event и подделать отдельную "серверную" строку лога (log injection);
// JSON.stringify ниже уже безопасно экранирует data, event — обычная
// конкатенация в текст, поэтому его отдельно валидируем.
const EVENT_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const MAX_DATA_JSON_LENGTH = 2000;

/**
 * POST /api/client-log — единая точка входа для клиентских событий (смена
 * вкладки/озвучки/качества плеера, retry, ошибки hls.js и т.п.), которые
 * иначе видны только в консоли браузера конкретного пользователя и
 * теряются, как только он закрывает вкладку. Пишет ОДНУ строку в тот же
 * stdout, что и остальной серверный console.log/error ([proxy/raw],
 * [alloha], [server] и т.п.) — читается тем же `pm2 logs mediawatch-web`,
 * которым уже пользовались для диагностики сегодняшних инцидентов
 * (зависание сика при возобновлении, приглушение звука у новых
 * посетителей — оба нашлись только через ручное воспроизведение в
 * браузере, а не по логам).
 *
 * Никакой БД — это диагностический, а не бизнес-канал: строки не нужно
 * запрашивать структурно, только грепать по `user=<id>` при разборе
 * конкретной жалобы («у меня не грузится серия X»).
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`client-log:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!rl.allowed) {
    // Не 429 с ошибкой в консоли клиента — это диагностический канал,
    // молчаливый отказ безопаснее (см. logEvent в lib/clientLog.ts, там
    // и так .catch(() => {})), просто не пишем эту порцию.
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }

  let body: { event?: string; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  const event = String(body.event ?? '');
  if (!EVENT_PATTERN.test(event)) {
    return NextResponse.json({ ok: false, reason: 'bad_event' }, { status: 400 });
  }

  const {
    data: { user },
  } = await getCachedUser();

  let dataJson: string;
  try {
    dataJson = JSON.stringify(body.data ?? {});
  } catch {
    dataJson = '{}';
  }
  if (dataJson.length > MAX_DATA_JSON_LENGTH) {
    dataJson = `${dataJson.slice(0, MAX_DATA_JSON_LENGTH)}...(truncated)`;
  }

  console.log(`[client] user=${user?.id ?? 'anon'} event=${event} data=${dataJson}`);
  return NextResponse.json({ ok: true });
}
