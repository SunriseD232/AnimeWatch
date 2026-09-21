import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refreshCinemaGenres } from '@/lib/cinemaGenres';

/**
 * GET /api/cron/refresh-cinema-genres — жанры каталога кино из выгрузки IMDb
 * (см. lib/cinemaGenres.ts и миграцию 0040).
 *
 * Раз в неделю: жанр у вышедшего тайтла не меняется, а новые приезжают
 * вместе с ночной перестройкой и подхватываются ближайшим прогоном.
 *
 * Прогон НЕ трогает cinema_index — ровно как у рейтингов: свежие жанры
 * доезжают до выдачи следующей ночью, когда перестройка сольёт их с тем, что
 * отдал Videoseed. Так недельный джоб не может испортить работающий каталог.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await refreshCinemaGenres();
    console.log(
      `[cinema-genres] готово: нашли ${result.matched} из ${result.wanted} тайтлов, ` +
        `у ${result.withGenres} есть наши жанры, просмотрено ${result.scanned} строк выгрузки ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cinema-genres] упал:', message);

    try {
      await createServiceClient()
        .from('cinema_index_state')
        .update({ genres_error: message, genres_run_finished_at: new Date().toISOString() })
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
