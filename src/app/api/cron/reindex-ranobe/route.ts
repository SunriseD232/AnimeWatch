import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rebuildRanobeIndex } from '@/lib/ranobeIndex';

/**
 * GET /api/cron/reindex-ranobe — перестройка витрины каталога ранобэ
 * (см. lib/ranobeIndex.ts и миграцию 0055).
 *
 * Защита и приём те же, что у reindex-books: Authorization: Bearer
 * CRON_SECRET, а исход пишется в ranobe_index_state.last_error — логи PM2
 * ротируются, а «индекс ранобэ вообще собирался?» должно быть видно со
 * страницы /admin/status.
 *
 * ~37 запросов к Renovels с паузой 250 мс, поэтому maxDuration с запасом.
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
    const result = await rebuildRanobeIndex();
    console.log(
      `[reindex-ranobe] готово: ${result.ranobe} тайтлов, ${result.requests} запросов ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-ranobe] упал:', message);

    // Причину — в состояние. Витрина при этом не тронута: сбор идёт в
    // память, а запись начинается только после проверки на вменяемость
    // (см. lib/ranobeIndex.ts).
    try {
      await createServiceClient()
        .from('ranobe_index_state')
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
