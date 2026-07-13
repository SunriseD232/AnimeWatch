import { NextResponse, type NextRequest } from 'next/server';
import { createVideoSource } from '@/lib/video/kodik';

/**
 * Проксирует поиск embed-плеера (Режим A). Токен Kodik остаётся на сервере.
 * Используется клиентом для смены озвучки/серии без полной перезагрузки.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shikimoriId = Number(searchParams.get('shikimoriId'));
  const episode = Number(searchParams.get('episode') ?? '1');
  const translationParam = searchParams.get('translationId');
  const startParam = searchParams.get('startFrom');

  if (!Number.isFinite(shikimoriId)) {
    return NextResponse.json(
      { error: 'shikimoriId required' },
      { status: 400 },
    );
  }

  const source = createVideoSource();
  try {
    const result = await source.getEmbedUrl({
      shikimoriId,
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
