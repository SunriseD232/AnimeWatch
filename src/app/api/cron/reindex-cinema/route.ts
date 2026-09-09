import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rebuildCinemaIndex } from '@/lib/cinemaIndex';

/**
 * GET /api/cron/reindex-cinema — суточная полная перестройка локального
 * индекса каталога кино (см. lib/cinemaIndex.ts и миграцию 0027).
 *
 * Защита та же, что у reindex-anime: заголовок Authorization с CRON_SECRET.
 * Дёргается системным кроном на VPS. Время намеренно НЕ совпадает с
 * перестройкой аниме: та идёт в 02:00 UTC и занимает ~13 минут, обе разом
 * упёрлись бы в один и тот же процесс PM2 и в один и тот же диск.
 *
 * Рейтинги TMDB тут не трогаются — у них свой недельный крон
 * (refresh-cinema-ratings): 103 тысячи запросов через VLESS-туннель внутри
 * ночной перестройки превратили бы её из семиминутной в трёхчасовую.
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
    const result = await rebuildCinemaIndex();
    console.log(
      `[reindex-cinema] готово: ${result.titles} тайтлов ` +
        `(${result.movies} фильмов, ${result.serials} сериалов), ` +
        `${result.genres} жанров, ${result.countries} стран, ` +
        `${result.rated} с рейтингом, ${result.pages} страниц ` +
        `за ${Math.round(result.durationMs / 1000)} сек, квоты осталось ${result.quotaLeft}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reindex-cinema] упал:', message);

    // Пишем причину в состояние индекса — иначе о неудачной ночной
    // перестройке можно узнать только из логов PM2, а они ротируются.
    // Указатель активной партии при этом не тронут: каталог продолжает
    // работать на прошлой, целой партии.
    try {
      await createServiceClient()
        .from('cinema_index_state')
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
