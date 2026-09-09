import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refreshCinemaRatings } from '@/lib/cinemaRatings';

/**
 * GET /api/cron/refresh-cinema-ratings — недельное обновление рейтингов
 * TMDB для каталога кино (см. lib/cinemaRatings.ts и миграцию 0027).
 *
 * Раз в неделю, а не каждую ночь, потому что TMDB не отдаёт рейтинги пачкой:
 * один запрос на тайтл, 103 тысячи тайтлов, всё через VLESS-туннель.
 *
 * ?limit= — бюджет запросов на прогон (по умолчанию 40 000, примерно час).
 * Параметр нужен для первичного залива: его удобно гонять руками кусками, а
 * не ждать трёх часов от одного процесса под PM2.
 *
 * Прогон НЕ трогает cinema_index: свежие рейтинги доезжают до выдачи
 * следующей ночью, когда перестройка скопирует их в партию. Так недельный
 * джоб не может испортить работающий каталог, что бы с ним ни случилось.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 7200;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.trunc(limitParam) : undefined;

  try {
    const result = await refreshCinemaRatings(limit);
    console.log(
      `[cinema-ratings] готово: проверено ${result.checked} из ${result.candidates} кандидатов, ` +
        `${result.updated} с рейтингом, ${result.missed} без, ${result.failed} сетевых неудач ` +
        `за ${Math.round(result.durationMs / 1000)} сек` +
        (result.stoppedEarly ? ' — остановлен по потолку времени, остальное доберём в следующий раз' : ''),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cinema-ratings] упал:', message);

    try {
      await createServiceClient()
        .from('cinema_index_state')
        .update({ ratings_error: message, ratings_run_finished_at: new Date().toISOString() })
        .eq('id', true);
    } catch {
      /* состояние записать не удалось — в логе причина уже есть */
    }

    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
