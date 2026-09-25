import { NextResponse, type NextRequest } from 'next/server';
import { refreshRecommendations } from '@/lib/recommendationsEngine';

// maxDuration — потолок для serverless-платформ (Vercel), на self-hosted
// Node/PM2 ни на что не влияет. Реальный предел здесь — nginx
// proxy_read_timeout, и именно поэтому крон НЕ ждёт результата (см. ниже):
// openrouter.ai ходит через VLESS-туннель (см. lib/net/vlessProxy.ts,
// «Access denied by security policy» напрямую с этой VPS), а с ним один
// запрос к модели ощутимо медленнее прямого — на два раздела и десятки
// пользователей суммарно это уже больше минуты, дольше, чем готов ждать
// nginx перед тем, как оборвать HTTP-соединение 504-й.
export const maxDuration = 60;

/**
 * Суточный крон рекомендаций (см. план редизайна главной): считает
 * персональные подборки «Рекомендуем посмотреть» через OpenRouter и
 * докачивает backdrop всего списка. Какой тайтл станет hero — решает не
 * крон, а сам рендер главной (см. getHeroPick в lib/recommendations.ts) —
 * случайно из уже закэшированных здесь, при каждом заходе заново.
 *
 * В отличие от остальных крон-роутов (check-episodes и т.п.) — не ждёт
 * refreshRecommendations() и отвечает сразу: сама функция продолжает
 * работать в фоне (обычный процесс под PM2, а не serverless-функция,
 * которую платформа заморозит после ответа — код после return
 * действительно продолжает выполняться). Прогресс/ошибки — только в логах
 * PM2 (`[recommendationsEngine] ...`), у самого HTTP-ответа результата не
 * дождаться никогда, даже если бы nginx и не резал соединение по таймауту.
 *
 * Расписание — на VPS, после реиндексации и докачки постеров (см.
 * README.md «Расписание фоновых задач» — crontab -l и
 * /etc/cron.d/mediawatch-check-episodes, оба места).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  refreshRecommendations()
    .then((result) => {
      console.log('[cron/refresh-recommendations] готово:', JSON.stringify(result));
    })
    .catch((err) => {
      console.error(
        '[cron/refresh-recommendations] упал:',
        err instanceof Error ? err.message : err,
      );
    });

  return NextResponse.json({ ok: true, started: true });
}
