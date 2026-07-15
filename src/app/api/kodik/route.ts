import { NextResponse, type NextRequest } from 'next/server';
import { createVideoSource } from '@/lib/video/kodik';

/**
 * Проксирует поиск embed-плеера (Режим A). Токен Kodik остаётся на сервере.
 * Используется клиентом для смены озвучки/серии без полной перезагрузки.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shikimoriParam = searchParams.get('shikimoriId');
  const kinopoiskParam = searchParams.get('kinopoiskId');
  const shikimoriId = Number(shikimoriParam);
  const kinopoiskId = Number(kinopoiskParam);
  const episode = Number(searchParams.get('episode') ?? '1');
  const seasonParam = searchParams.get('season');
  const season = Number(seasonParam);
  const translationParam = searchParams.get('translationId');
  const startParam = searchParams.get('startFrom');

  const hasKinopoisk = kinopoiskParam !== null && Number.isFinite(kinopoiskId);
  const hasShikimori = shikimoriParam !== null && Number.isFinite(shikimoriId);
  if (!hasKinopoisk && !hasShikimori) {
    return NextResponse.json(
      { error: 'shikimoriId or kinopoiskId required' },
      { status: 400 },
    );
  }

  const source = createVideoSource();
  try {
    const result = await source.getEmbedUrl({
      shikimoriId: hasKinopoisk ? undefined : shikimoriId,
      kinopoiskId: hasKinopoisk ? kinopoiskId : undefined,
      season:
        seasonParam !== null && Number.isFinite(season) && season > 0
          ? season
          : undefined,
      episode: Number.isFinite(episode) ? episode : 1,
      translationId: translationParam
        ? Number(translationParam)
        : undefined,
      startFrom: startParam ? Number(startParam) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'kodik error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
