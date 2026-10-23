import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

/**
 * «Продолжить читать» на странице книг.
 *
 * Устроено как PodcastContinue: последние строки из watch_progress по
 * updated_at, обложка и процент. Ссылка ведёт прямо в читатель — на то же
 * место (CFI/прокрутка восстанавливаются там, см. /books/read/[id]).
 *
 * Название и обложку берём из строки прогресса, а не из book_index: книгу
 * могли убрать из витрины Флибусты, а история чтения всё равно должна
 * показываться.
 */
export default async function BookContinue() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'book')
    .order('updated_at', { ascending: false })
    .limit(6);

  const entries = (data ?? []) as WatchProgress[];
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Продолжить читать</h2>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map((p) => {
          const percent =
            p.progress_percent != null
              ? Math.round(Math.max(0, Math.min(1, p.progress_percent)) * 100)
              : null;
          // Обложка в строке истории маленькая (44×64), а оригинал — PNG на
          // сотни килобайт. Просим у прокси 240 px, как карточки каталога.
          const poster = p.poster_url
            ? `${p.poster_url}${p.poster_url.includes('?') ? '&' : '?'}w=240`
            : null;
          return (
            <Link
              key={p.id}
              href={`/books/read/${p.shikimori_id}`}
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
                <p className="text-xs text-gray-400">
                  {percent != null ? `${percent}% прочитано` : 'Начато'}
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
          );
        })}
      </div>
    </section>
  );
}
