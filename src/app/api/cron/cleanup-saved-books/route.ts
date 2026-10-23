import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cleanupSavedBooks } from '@/lib/bookStorage';

/**
 * GET /api/cron/cleanup-saved-books — уборка книг, сохранённых на сервере
 * (lib/bookStorage.ts, миграция 0058): просроченные сохранения, файлы без
 * ссылок, сироты на диске.
 *
 * Защита та же, что у остальных кронов: Authorization: Bearer CRON_SECRET.
 * Итог — в book_storage_state, чтобы объём хранилища и ошибка последнего
 * прогона были видны на /admin/status.
 */
export const dynamic = 'force-dynamic';
// Обычно секунды. Долго — только если пришлось перекачивать пропавшие
// файлы с Флибусты.
export const maxDuration = 600;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date().toISOString();
  await supabase
    .from('book_storage_state')
    .update({ last_run_started_at: startedAt })
    .eq('id', true);

  try {
    const result = await cleanupSavedBooks();
    await supabase
      .from('book_storage_state')
      .update({
        files_count: result.filesCount,
        bytes_total: result.bytesTotal,
        last_run_finished_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', true);
    console.log(
      `[cleanup-saved-books] снято просроченных ${result.expiredRemoved}, файлов удалено ` +
        `${result.filesDeleted}, перекачано ${result.filesRefetched}, сирот ${result.orphansDeleted}; ` +
        `на диске ${result.filesCount} файлов, ${Math.round(result.bytesTotal / 1024 / 1024)} МБ`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cleanup-saved-books] упал:', message);
    try {
      await supabase
        .from('book_storage_state')
        .update({ last_error: message, last_run_finished_at: new Date().toISOString() })
        .eq('id', true);
    } catch {
      /* причина уже в логе */
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
