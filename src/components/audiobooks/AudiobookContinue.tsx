import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import RemovableRow from '@/components/RemovableRow';
import { fixPosterUrl, watchPercent } from '@/lib/format';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';
import { audiobookHref } from '@/lib/audiobookShared';

/**
 * «Продолжить слушать» в разделе аудиокниг — тот же блок, что у подкастов
 * (PodcastContinue): последние аудиокниги из watch_progress по updated_at,
 * строка с обложкой, частью и прогрессом части, крестик «Убрать».
 *
 * Ссылка — на страницу аудиокниги, а не на конкретную часть: плеер там сам
 * продолжает с сохранённой части и секунды. Название и обложка — из строки
 * прогресса: книгу могли снять с источника, а история должна показаться.
 */
export default async function AudiobookContinue() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'audiobook')
    .order('updated_at', { ascending: false })
    .limit(6);

  const entries = (data ?? []) as WatchProgress[];
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Продолжить слушать</h2>
        <Link href="/profile?tab=history" className="text-sm text-accent-text hover:underline">
          Вся история
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map((p) => {
          const percent = watchPercent(p.position_seconds, p.duration_seconds);
          return (
            <RemovableRow key={p.id} contentType="audiobook" id={p.shikimori_id} title={p.anime_title}>
            <Link
              href={audiobookHref(p.shikimori_id)}
              prefetch={false}
              className="press flex items-center gap-3 rounded-2xl bg-bg-card p-3 ring-1 ring-inset ring-white/5 transition hover:ring-accent/60"
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-bg-soft">
                <PosterImage
                  sources={[fixPosterUrl(p.poster_url)]}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="line-clamp-1 text-sm font-medium">{p.anime_title}</p>
                <p className="text-xs text-gray-400">
                  Часть {p.episode}
                  {percent != null ? ` · ${percent}%` : ''}
                </p>
                {percent != null ? (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-bg-soft"
                  >
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                ) : null}
              </div>
            </Link>
            </RemovableRow>
          );
        })}
      </div>
    </section>
  );
}
