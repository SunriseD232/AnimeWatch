import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ContentType, WatchProgress } from '@/lib/types';

interface SyncItem {
  key: string;
  contentType: ContentType;
  contentId: number;
  season: number;
  episode: number;
  positionSeconds: number;
  durationSeconds: number | null;
  title: string;
  posterUrl: string | null;
  translationId: number | null;
  translationTitle: string | null;
}

interface SyncResult {
  key: string;
  applied: boolean;
  server?: {
    season: number;
    episode: number;
    positionSeconds: number;
    durationSeconds: number | null;
    translationId: number | null;
    translationTitle: string | null;
  };
}

/**
 * POST /api/progress/sync — батч-примирение офлайн-прогресса (см. план
 * офлайн-загрузок, фаза C: OfflineDownloadManager копит позицию во время
 * плеера БЕЗ сети в pendingProgress.json, OfflineSyncTrigger.tsx шлёт сюда
 * накопленное при восстановлении связи).
 *
 * В отличие от /api/progress (слепой upsert — кто последний написал, тот и
 * победил, годится для обычного online-плеера, где события идут по
 * порядку) — тут сравниваем «нарративный» прогресс (season → episode →
 * position_seconds), а не updated_at: часы телефона в поездке/офлайне не
 * источник истины, а вот "серия дальше" или "позиция дальше в той же
 * серии" однозначно отражает, что пользователь посмотрел больше. Если
 * сервер оказался «дальше» (прогресс пришёл с другого устройства, пока
 * телефон был офлайн) — не перезаписываем, возвращаем серверное значение,
 * чтобы клиент подтянул его к себе.
 */
export async function POST(request: NextRequest) {
  let body: { items?: SyncItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const results: SyncResult[] = [];

  for (const item of items) {
    const contentType: ContentType = item.contentType === 'cinema' ? 'cinema' : 'anime';
    const contentId = Number(item.contentId);
    const season = Number.isFinite(item.season) && item.season >= 1 ? item.season : 1;
    const episode = Number(item.episode);
    const position = Number(item.positionSeconds);

    if (!Number.isFinite(contentId) || !Number.isFinite(episode) || !Number.isFinite(position)) {
      results.push({ key: item.key, applied: false });
      // eslint-disable-next-line no-continue
      continue;
    }

    // Случайные "открытия" (< 5 сек) не сохраняем — как в /api/progress.
    if (position < 5) {
      results.push({ key: item.key, applied: false });
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('user_id', user.id)
      .eq('content_type', contentType)
      .eq('shikimori_id', contentId)
      .maybeSingle();
    const existing = data as WatchProgress | null;

    const incomingIsFurther =
      !existing ||
      season > existing.season ||
      (season === existing.season && episode > existing.episode) ||
      (season === existing.season && episode === existing.episode && position > existing.position_seconds);

    if (!incomingIsFurther) {
      results.push({
        key: item.key,
        applied: false,
        server: {
          season: existing.season,
          episode: existing.episode,
          positionSeconds: existing.position_seconds,
          durationSeconds: existing.duration_seconds,
          translationId: existing.translation_id,
          translationTitle: existing.translation_title,
        },
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from('watch_progress').upsert(
      {
        user_id: user.id,
        content_type: contentType,
        shikimori_id: contentId,
        anime_title: item.title || 'Без названия',
        poster_url: item.posterUrl,
        season,
        episode,
        position_seconds: position,
        duration_seconds: item.durationSeconds ?? null,
        translation_id: item.translationId ?? null,
        translation_title: item.translationTitle ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,content_type,shikimori_id' },
    );

    results.push({ key: item.key, applied: !error });
  }

  return NextResponse.json({ results });
}
