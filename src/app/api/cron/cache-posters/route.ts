import { NextResponse, type NextRequest } from 'next/server';
import { cachePosters, type PosterKind } from '@/lib/posterCache';

/**
 * GET /api/cron/cache-posters?kind=anime|cinema&limit=N — докачивает обложки
 * в локальный кэш (см. lib/posterCache.ts и миграцию 0029).
 *
 * Запускается после ночных перестроек: новые тайтлы за сутки — это десятки
 * картинок, прогон занимает секунды. Первичный залив (117 тысяч обложек,
 * ~2,8 ГБ) гоняется руками кусками через ?limit=.
 *
 * Прогон НИЧЕГО не ломает при неудаче: страницы продолжают отдавать ссылку
 * на апстрим, пока файла нет, — см. цепочку запасных ссылок в
 * components/PosterImage.tsx.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 5400;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const kindParam = request.nextUrl.searchParams.get('kind');
  const kinds: PosterKind[] =
    kindParam === 'anime' || kindParam === 'cinema' ? [kindParam] : ['anime', 'cinema'];

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.trunc(limitParam) : undefined;

  const startedAt = Date.now();

  try {
    const results = [];
    for (const kind of kinds) {
      const result = await cachePosters(kind, limit);
      console.log(
        `[cache-posters] ${kind}: скачано ${result.stored}, пусто ${result.missed}, ` +
          `сбоев ${result.failed} из ${result.candidates} кандидатов, ` +
          `${Math.round(result.bytes / 1024 / 1024)} МБ за ${Math.round(result.durationMs / 1000)} сек` +
          (result.stoppedEarly ? ' — остановлен по потолку времени' : ''),
      );
      results.push(result);
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cache-posters] упал:', message);
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
