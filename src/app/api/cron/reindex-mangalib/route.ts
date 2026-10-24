import { NextResponse, type NextRequest } from 'next/server';
import { syncMangaLibCatalog } from '@/lib/mangalibCatalog';

/**
 * GET /api/cron/reindex-mangalib — еженедельная синхронизация каталога
 * MangaLib (lib/mangalibCatalog.ts): склейка с Remanga и карточки для того,
 * чего у Remanga нет. Идёт после полного обхода Remanga — склеивать есть с
 * чем. ~690 страниц с паузой 300 мс — около 10 минут, плюс
 * обход по жанрам и тегам для фильтров каталога (несколько тысяч страниц,
 * около часа) — отсюда maxDuration с запасом, как у полных обходов.
 *
 * Защита — Authorization: Bearer CRON_SECRET. Исход — в source_link_state
 * (job = 'mangalib-catalog'), видно на /admin/status; туда же пишет причину
 * сам syncMangaLibCatalog.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 9000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await syncMangaLibCatalog();
    console.log(
      `[reindex-mangalib] готово: ${result.titles} тайтлов, склеено с Remanga ${result.matched}, ` +
        `своих карточек ${result.ownCards}, ${result.requests} запросов за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-mangalib] упал:', message);
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
