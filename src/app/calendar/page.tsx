import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { getAnime, imageUrl } from '@/lib/shikimori';
import { mapWithConcurrency } from '@/lib/concurrency';
import type { UserListItem } from '@/lib/types';

export const metadata = { title: 'Календарь выхода серий — MediaWatch' };

interface CalendarRow {
  id: number;
  title: string;
  poster: string | null;
  nextEpisodeAt: string;
  nextEpisode: number;
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** «сегодня» / «завтра» / «через 3 дня» / «5 дней назад» (для просроченных). */
function relativeLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days < 0) return `ожидалась ${new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
  const mod10 = days % 10;
  const mod100 = days % 100;
  let word = 'дней';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = 'день';
    else if (mod10 >= 2 && mod10 <= 4) word = 'дня';
  }
  return `через ${days} ${word}`;
}

export default async function CalendarPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) redirect('/login?redirect=/calendar');

  const { data } = await supabase
    .from('user_list')
    .select('*')
    .eq('content_type', 'anime')
    .eq('status', 'watching');

  const watching = (data ?? []) as UserListItem[];

  const rows = (
    await mapWithConcurrency(watching, 4, async (item) => {
      try {
        const anime = await getAnime(item.shikimori_id);
        if (anime.status !== 'ongoing' || !anime.next_episode_at) return null;
        const row: CalendarRow = {
          id: item.shikimori_id,
          title: anime.russian || anime.name,
          poster: imageUrl(anime.image?.preview),
          nextEpisodeAt: anime.next_episode_at,
          nextEpisode: anime.episodes_aired + 1,
        };
        return row;
      } catch {
        return null;
      }
    })
  )
    .filter((r): r is CalendarRow => r !== null)
    .sort((a, b) => a.nextEpisodeAt.localeCompare(b.nextEpisodeAt));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Календарь выхода серий</h1>
        <p className="text-sm text-gray-400">
          Онгоинги из «Смотрю» с датой следующей серии, известной Shikimori.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-bg-card px-6 py-10 text-center">
          <span className="text-3xl" aria-hidden="true">
            📅
          </span>
          <p className="text-sm text-gray-400">
            Нет онгоингов с известной датой следующей серии — либо в «Смотрю»
            пусто, либо там только завершённые тайтлы.
          </p>
          <Link
            href="/catalog"
            className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            Найти что посмотреть →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/anime/${row.id}`}
              className="card-lift flex items-center gap-3 rounded-xl bg-bg-card p-2.5 ring-1 ring-white/5 hover:ring-accent/60"
            >
              <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                {row.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.poster}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-gray-100">
                  {row.title}
                </span>
                <span className="text-xs text-gray-400">
                  Серия {row.nextEpisode}
                </span>
              </div>
              <span className="shrink-0 text-xs font-medium text-accent">
                {relativeLabel(row.nextEpisodeAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
