import { NextResponse, type NextRequest } from 'next/server';
import { refreshCinemaExtRatings } from '@/lib/cinemaExtRatings';

/**
 * GET /api/cron/refresh-cinema-ext-ratings — рейтинги Кинопоиска и IMDb для
 * каталога кино (см. lib/cinemaExtRatings.ts и миграцию 0049).
 *
 * Каждую ночь ДО перестройки каталога (она в 05:20 копирует оценки в
 * cinema_index): пополняет непроверенные тайтлы и освежает протухшие в
 * пределах потолка запросов. Каталог прогон не трогает — как и у рейтингов
 * TMDB, работающую выдачу он испортить не может.
 *
 * ?budget=N — разовый прогон с другим потолком (первое наполнение).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const budgetRaw = Number(request.nextUrl.searchParams.get('budget'));
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.min(budgetRaw, 100_000) : undefined;

  try {
    const result = await refreshCinemaExtRatings(budget);
    console.log(
      `[cinema-ext-ratings] готово: запрошено ${result.requested} из ${result.candidates} кандидатов, ` +
        `КП у ${result.withKp}, IMDb у ${result.withImdb}, сбоев ${result.failed} ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cinema-ext-ratings] упал:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
