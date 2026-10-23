import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rebuildBookIndex } from '@/lib/bookIndex';

/**
 * GET /api/cron/reindex-books — перестройка витрины каталога книг
 * (см. lib/bookIndex.ts и миграцию 0054).
 *
 * Защита и приём те же, что у reindex-podcasts: Authorization: Bearer
 * CRON_SECRET, а исход пишется в book_index_state.last_error — логи PM2
 * ротируются, а «индекс books вообще собирался?» должно быть видно со
 * страницы /admin/status.
 *
 * Обход Флибусты идёт с паузой 0,7 сек между запросами (~120 запросов за
 * прогон), поэтому maxDuration не жёсткий.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await rebuildBookIndex();
    console.log(
      `[reindex-books] готово: ${result.books} книг, ${result.requests} запросов ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-books] упал:', message);

    // Причину — в состояние. Витрина при этом не тронута: сбор идёт в
    // память, а запись начинается только после проверки на вменяемость
    // (см. lib/bookIndex.ts).
    try {
      await createServiceClient()
        .from('book_index_state')
        .update({ last_error: message, last_run_finished_at: new Date().toISOString() })
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
