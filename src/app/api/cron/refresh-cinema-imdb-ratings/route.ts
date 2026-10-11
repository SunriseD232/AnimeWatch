import { NextResponse, type NextRequest } from 'next/server';
import { refreshCinemaImdbRatings } from '@/lib/cinemaImdbRatings';

/**
 * GET /api/cron/refresh-cinema-imdb-ratings — оценки IMDb из официальной
 * выгрузки (см. lib/cinemaImdbRatings.ts и миграцию 0050).
 *
 * Каждую ночь до перестройки каталога (05:20): выгрузка обновляется
 * ежедневно, а прогон — один файл на несколько секунд. Каталог не трогает:
 * оценки доезжают до выдачи ближайшей перестройкой.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await refreshCinemaImdbRatings();
    console.log(
      `[cinema-imdb-ratings] готово: нашли ${result.matched} из ${result.wanted} тайтлов, ` +
        `просмотрено ${result.scanned} строк выгрузки за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cinema-imdb-ratings] упал:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
