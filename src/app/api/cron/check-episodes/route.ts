import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { episodeCount, getAnime } from '@/lib/shikimori';
import { getCinemaById } from '@/lib/videoseed-catalog';
import type { ContentType } from '@/lib/types';

// До 60 сек — потолок serverless-функций на Hobby-тарифе Vercel. Проверка
// идёт по тайтлам последовательно (внешние API уже сами троттлятся), так что
// при большом списке "смотрю" может не уложиться — это не критично: то, что
// не успели, подхватится на следующем суточном прогоне.
export const maxDuration = 60;

interface WatchingRow {
  content_type: ContentType;
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
}

/** Текущее число серий тайтла: Shikimori для аниме, Videoseed для кино. */
async function getCurrentEpisodeCount(
  contentType: ContentType,
  shikimoriId: number,
): Promise<number | null> {
  try {
    if (contentType === 'anime') {
      const anime = await getAnime(shikimoriId);
      return episodeCount(anime);
    }
    const item = await getCinemaById(shikimoriId);
    return item?.episodesTotal ?? null;
  } catch {
    return null;
  }
}

/**
 * Крон раз в сутки (см. vercel.json): для каждого тайтла в статусе
 * 'watching' у кого-либо сравнивает текущее число серий с последним
 * известным (title_episode_baseline) и создаёт уведомление всем, кто его
 * смотрит, если серий стало больше. Первая проверка тайтла — только
 * молчаливый посев baseline, без уведомления (иначе старые серии считались
 * бы «новыми» задним числом).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: watching, error } = await supabase
    .from('user_list')
    .select('content_type, shikimori_id, anime_title, poster_url')
    .eq('status', 'watching');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Дедуп по тайтлу — не проверяем одно и то же дважды, даже если его
  // смотрят несколько пользователей.
  const seen = new Set<string>();
  const titles = ((watching ?? []) as WatchingRow[]).filter((row) => {
    const key = `${row.content_type}:${row.shikimori_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let checked = 0;
  let notified = 0;

  for (const row of titles) {
    checked += 1;
    try {
      const current = await getCurrentEpisodeCount(
        row.content_type,
        row.shikimori_id,
      );
      if (current === null) continue;

      const { data: baseline } = await supabase
        .from('title_episode_baseline')
        .select('known_episodes')
        .eq('content_type', row.content_type)
        .eq('shikimori_id', row.shikimori_id)
        .maybeSingle();

      if (!baseline) {
        // Первая проверка тайтла — только посев, без уведомления.
        await supabase.from('title_episode_baseline').upsert({
          content_type: row.content_type,
          shikimori_id: row.shikimori_id,
          known_episodes: current,
          checked_at: new Date().toISOString(),
        });
        continue;
      }

      if (current > baseline.known_episodes) {
        const { data: watchers } = await supabase
          .from('user_list')
          .select('user_id')
          .eq('status', 'watching')
          .eq('content_type', row.content_type)
          .eq('shikimori_id', row.shikimori_id);

        const rows = ((watchers ?? []) as { user_id: string }[]).map((w) => ({
          user_id: w.user_id,
          content_type: row.content_type,
          shikimori_id: row.shikimori_id,
          title: row.anime_title,
          poster_url: row.poster_url,
          episode: current,
        }));

        if (rows.length > 0) {
          await supabase.from('episode_notifications').upsert(rows, {
            onConflict: 'user_id,content_type,shikimori_id,episode',
            ignoreDuplicates: true,
          });
          notified += rows.length;
        }

        await supabase
          .from('title_episode_baseline')
          .update({
            known_episodes: current,
            checked_at: new Date().toISOString(),
          })
          .eq('content_type', row.content_type)
          .eq('shikimori_id', row.shikimori_id);
      } else {
        await supabase
          .from('title_episode_baseline')
          .update({ checked_at: new Date().toISOString() })
          .eq('content_type', row.content_type)
          .eq('shikimori_id', row.shikimori_id);
      }
    } catch {
      // Единичный сбой не должен рушить весь прогон — идём дальше.
    }
  }

  return NextResponse.json({ checked, notified });
}
