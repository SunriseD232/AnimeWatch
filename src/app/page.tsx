import { Suspense } from 'react';
import Link from 'next/link';
import AnimeCard from '@/components/AnimeCard';
import ContinueCard from '@/components/ContinueCard';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import { GENRE_CHIPS, getPopular, getTopRecent } from '@/lib/shikimori';
import { createClient } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

async function ContinueWatching() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginBanner />;
  }

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'anime')
    .order('updated_at', { ascending: false })
    .limit(12);

  const progress = (data ?? []) as WatchProgress[];

  if (progress.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Здесь появятся тайтлы, которые вы смотрите. Начните с популярного
        ниже.
      </div>
    );
  }

  // Горизонтальная карусель: последние просмотренные листаются вбок.
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {progress.map((p) => (
        <div key={p.id} className="w-56 shrink-0 snap-start sm:w-72">
          <ContinueCard progress={p} />
        </div>
      ))}
    </div>
  );
}

/** Топ рейтинга из недавно вышедших, с фильтром по жанру. */
async function TopRecent({ genreId }: { genreId?: number }) {
  try {
    const animes = await getTopRecent(genreId, 18);
    if (animes.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          В этом жанре пока нет недавних тайтлов.
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {animes.map((a, i) => (
          <div key={a.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 11) * 40}ms` }}>
            <AnimeCard anime={a} />
          </div>
        ))}
      </div>
    );
  } catch {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Shikimori. Попробуйте обновить страницу
        позже.
      </div>
    );
  }
}

async function Popular() {
  try {
    const animes = await getPopular(18);
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {animes.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>
    );
  } catch {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Shikimori. Попробуйте обновить страницу
        позже.
      </div>
    );
  }
}

export default function HomePage({
  searchParams,
}: {
  searchParams: { genre?: string };
}) {
  const genreParam = Number(searchParams.genre);
  const genreId =
    Number.isFinite(genreParam) &&
    GENRE_CHIPS.some((g) => g.id === genreParam)
      ? genreParam
      : undefined;

  return (
    <div className="flex flex-col gap-10">
      <ModeSwitch active="anime" />

      <section className="animate-rise flex flex-col gap-4">
        <h1 className="text-xl font-bold">Продолжить просмотр</h1>
        <Suspense fallback={<CardGridSkeleton count={4} />}>
          <ContinueWatching />
        </Suspense>
      </section>

      <section className="animate-rise flex flex-col gap-4" style={{ animationDelay: '80ms' }}>
        <h2 className="text-xl font-bold">Лучшее из недавнего</h2>

        {/* Чипы жанров */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Link
            href="/"
            scroll={false}
            className={[
              'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
              genreId === undefined
                ? 'bg-accent text-white shadow-lg shadow-accent/25'
                : 'bg-bg-card text-gray-300 ring-1 ring-white/5 hover:bg-bg-soft hover:text-white',
            ].join(' ')}
          >
            Все
          </Link>
          {GENRE_CHIPS.map((g) => (
            <Link
              key={g.id}
              href={`/?genre=${g.id}`}
              scroll={false}
              className={[
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                genreId === g.id
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'bg-bg-card text-gray-300 ring-1 ring-white/5 hover:bg-bg-soft hover:text-white',
              ].join(' ')}
            >
              {g.label}
            </Link>
          ))}
        </div>

        <Suspense key={genreId ?? 'all'} fallback={<CardGridSkeleton count={12} />}>
          <TopRecent genreId={genreId} />
        </Suspense>
      </section>

      <section className="animate-rise flex flex-col gap-4" style={{ animationDelay: '160ms' }}>
        <h2 className="text-xl font-bold">Популярное сейчас</h2>
        <Suspense fallback={<CardGridSkeleton count={18} />}>
          <Popular />
        </Suspense>
      </section>
    </div>
  );
}
