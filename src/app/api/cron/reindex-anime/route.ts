import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rebuildAnimeIndex } from '@/lib/animeIndex';

/**
 * GET /api/cron/reindex-anime — суточная полная перестройка локального
 * индекса каталога (см. lib/animeIndex.ts и миграцию 0025).
 *
 * Защита та же, что у check-episodes: заголовок Authorization с CRON_SECRET.
 * Дёргается системным кроном на VPS в 02:00 UTC, то есть в 05:00 по Москве.
 *
 * maxDuration тут не выставляем, в отличие от check-episodes: обход всего
 * каталога — это ~480 запросов с паузой 700 мс, около шести минут, и потолок
 * в 60 секунд его бы просто убивал. Ограничение Vercel к этому проекту давно
 * не относится, сайт работает на своём VPS под PM2 (см. next.config.js), а
 * крон ходит на 127.0.0.1 в обход nginx с его таймаутами.
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
    const result = await rebuildAnimeIndex();
    console.log(
      `[reindex-anime] готово: ${result.titles} тайтлов, ${result.genres} пунктов таксономии, ` +
        `${result.pages} страниц за ${Math.round(result.durationMs / 1000)} сек`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-anime] упал:', message);

    // Пишем причину в состояние индекса — иначе о неудачной ночной
    // перестройке можно узнать только из логов PM2, а они ротируются.
    // Указатель активной партии при этом не тронут: каталог продолжает
    // работать на прошлой, целой партии.
    try {
      await createServiceClient()
        .from('anime_index_state')
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
