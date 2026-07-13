import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { WatchProgressInput } from '@/lib/types';

/**
 * Upsert прогресса просмотра. Вызывается как обычным fetch (keepalive),
 * так и navigator.sendBeacon при beforeunload — поэтому логика на сервере,
 * а не в браузерном клиенте (beacon отправляет cookies сессии).
 */
export async function POST(request: NextRequest) {
  let body: Partial<WatchProgressInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Аноним — просто ничего не сохраняем.
    return NextResponse.json({ ok: false, reason: 'anon' }, { status: 200 });
  }

  const shikimoriId = Number(body.shikimori_id);
  const episode = Number(body.episode);
  const position = Number(body.position_seconds);
  const contentType =
    body.content_type === 'cinema' ? 'cinema' : 'anime';

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode)) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }
  // Не сохраняем случайные открытия (< 5 сек).
  if (!Number.isFinite(position) || position < 5) {
    return NextResponse.json({ ok: false, reason: 'too-early' });
  }

  const { error } = await supabase.from('watch_progress').upsert(
    {
      user_id: user.id,
      content_type: contentType,
      shikimori_id: shikimoriId,
      anime_title: body.anime_title ?? 'Без названия',
      poster_url: body.poster_url ?? null,
      episode,
      position_seconds: position,
      duration_seconds:
        body.duration_seconds != null
          ? Number(body.duration_seconds)
          : null,
      translation_id:
        body.translation_id != null ? Number(body.translation_id) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,content_type,shikimori_id' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
