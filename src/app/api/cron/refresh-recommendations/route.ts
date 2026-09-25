import { NextResponse, type NextRequest } from 'next/server';
import { refreshRecommendations } from '@/lib/recommendationsEngine';

// Обход пользователей + OpenRouter (до нескольких секунд на запрос) +
// докачка backdrop'ов — на десятки пользователей укладывается в минуты, но
// потолок берём как у остальных крон-роутов с сетевыми походами.
export const maxDuration = 60;

/**
 * Суточный крон рекомендаций (см. план редизайна главной): считает
 * персональные подборки «Рекомендуем посмотреть» через OpenRouter и
 * hero-пик для главной, по образцу api/cron/check-episodes.
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

  try {
    const result = await refreshRecommendations();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/refresh-recommendations] упал:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
