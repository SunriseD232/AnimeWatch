import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import RemovableRow from '@/components/RemovableRow';
import { getRanobeById } from '@/lib/ranobe';
import {
  ranobeReadHref,
  ranobeTitleHref,
} from '@/lib/ranobeShared';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

/**
 * «Продолжить читать» на странице ранобэ.
 *
 * Устроено как BookContinue: последние строки из watch_progress по
 * updated_at. Ссылка ведёт прямо в читатель — на ту же главу и место
 * (locator.chapterId + locator.scrollPercent, см. /ranobe/read/...).
 *
 * Если в locator нет dir/chapterId (старая строка или прогресс пришёл
 * откуда-то ещё), ищем слаг в своём индексе по id и ведём на карточку:
 * выдумывать адрес главы нельзя.
 */
export default async function RanobeContinue() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'ranobe')
    .order('updated_at', { ascending: false })
    .limit(6);

  const entries = (data ?? []) as WatchProgress[];
  if (entries.length === 0) return null;

  const rows = await Promise.all(
    entries.map(async (p) => {
      const locator =
        p.locator && typeof p.locator === 'object' ? p.locator : null;
      const dir =
        locator && typeof locator.dir === 'string' ? locator.dir : null;
      const chapterId =
        locator && Number.isFinite(Number(locator.chapterId))
          ? Number(locator.chapterId)
          : null;
      const chapterLabel =
        locator && typeof locator.chapterLabel === 'string'
          ? locator.chapterLabel
          : `Глава ${p.episode}`;

      let href: string;
      if (dir && chapterId) {
        href = ranobeReadHref(dir, chapterId);
      } else {
        const fallback = await getRanobeById(p.shikimori_id);
        href = fallback ? ranobeTitleHref(fallback.dir) : '/ranobe';
      }

      return { progress: p, href, chapterLabel };
    }),
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Продолжить читать</h2>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(({ progress: p, href, chapterLabel }) => {
          const percent =
            p.progress_percent != null
              ? Math.round(Math.max(0, Math.min(1, p.progress_percent)) * 100)
              : null;
          const poster = p.poster_url
            ? `${p.poster_url}${p.poster_url.includes('?') ? '&' : '?'}w=240`
            : null;

          return (
            <RemovableRow key={p.id} contentType="ranobe" id={p.shikimori_id} title={p.anime_title}>
            <Link
              href={href}
              prefetch={false}
              className="press flex items-center gap-3 rounded-2xl bg-bg-card p-3 ring-1 ring-inset ring-white/5 transition hover:ring-accent/60"
            >
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                <PosterImage
                  sources={[poster]}
                  alt=""
                  className="h-full w-full object-cover"
                  placeholderClassName="grid h-full w-full place-items-center text-[10px] text-gray-500"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="line-clamp-2 text-sm font-medium">{p.anime_title}</p>
                <p className="line-clamp-1 text-xs text-gray-400">
                  {chapterLabel}
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
