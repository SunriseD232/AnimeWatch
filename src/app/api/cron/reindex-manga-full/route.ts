import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { crawlMangaFull } from '@/lib/mangaIndex';

/**
 * GET /api/cron/reindex-manga-full — еженедельный полный обход каталога манги
 * у Remanga (lib/catalogIndex.ts → crawlFull).
 *
 * В отличие от ночного reindex-manga (витрина популярного), этот прогон решает,
 * что вообще есть в каталоге: всё увиденное — in_catalog, не увиденное за
 * прогон — снимается. Если обход оборвался или увидел подозрительно мало,
 * каталог не урезается.
 *
 * Два прохода по 1000 страниц с паузой 250 мс — ~20 минут. Защита — Authorization: Bearer
 * CRON_SECRET, исход — в manga_index_state.last_error (/admin/status).
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
    const result = await crawlMangaFull();
    console.log(
      `[reindex-manga-full] готово: ${result.manga} тайтлов, ${result.requests} запросов ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-manga-full] упал:', message);

    // Причину — в состояние. Каталог при этом не урезан: снятие in_catalog
    // идёт только после полного и вменяемого обхода
    // (см. lib/mangaIndex.ts).
    try {
      await createServiceClient()
        .from('manga_index_state')
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
