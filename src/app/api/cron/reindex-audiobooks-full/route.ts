import { NextResponse, type NextRequest } from 'next/server';
import { crawlAudiobooksFull } from '@/lib/audiobookIndex';

/**
 * GET /api/cron/reindex-audiobooks-full — полный обход аудиокниг knigavuhe (~6,5 тыс. страниц) и сопоставление с книгами Флибусты
 * (lib/audiobookIndex.ts). Защита — Authorization: Bearer CRON_SECRET.
 * Исход — в audiobook_index_state, видно на /admin/status.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 12000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await crawlAudiobooksFull();
    console.log(
      `[reindex-audiobooks-full] готово: ${result.titles} книг, с парой во Флибусте ${result.matched}, ` +
        `${result.pages} страниц за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-audiobooks-full] упал:', message);
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
