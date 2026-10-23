import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rebuildPodcastIndex } from '@/lib/podcastIndex';

/**
 * GET /api/cron/reindex-podcasts — суточная перестройка локального каталога
 * подкастов (см. lib/podcastIndex.ts и миграцию 0052).
 *
 * Защита та же, что у reindex-anime: заголовок Authorization с CRON_SECRET.
 * Дёргается системным кроном на VPS. Обход регионов идёт с паузой между
 * запросами к iTunes (лимит ~20 запросов в минуту на IP), поэтому maxDuration
 * не жёсткий — прогон может идти десятки минут.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 5400;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await rebuildPodcastIndex();
    console.log(
      `[reindex-podcasts] готово: ${result.titles} подкастов, ${result.requests} запросов ` +
        `за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-podcasts] упал:', message);

    // Пишем причину в состояние — иначе о неудачной ночной перестройке можно
    // узнать только из логов PM2, а они ротируются. Указатель активной партии
    // при этом не тронут: каталог продолжает работать на прошлой.
    try {
      await createServiceClient()
        .from('podcast_index_state')
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
