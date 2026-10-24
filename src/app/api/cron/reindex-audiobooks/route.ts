import { NextResponse, type NextRequest } from 'next/server';
import { crawlAudiobooksNew } from '@/lib/audiobookIndex';

/**
 * GET /api/cron/reindex-audiobooks — новинки аудиокниг (первые страницы списка knigavuhe) и их сопоставление с книгами
 * (lib/audiobookIndex.ts). Защита — Authorization: Bearer CRON_SECRET.
 * Исход — в audiobook_index_state, видно на /admin/status.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 1200;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await crawlAudiobooksNew();
    console.log(
      `[reindex-audiobooks] готово: ${result.titles} книг, с парой во Флибусте ${result.matched}, ` +
        `${result.pages} страниц за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-audiobooks] упал:', message);
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
