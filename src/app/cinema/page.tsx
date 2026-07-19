import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import ContinueCard from '@/components/ContinueCard';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getPopularCinema } from '@/lib/videoseed-catalog';
import { createClient } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Фильмы и сериалы — MediaWatch' };

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
    .eq('content_type', 'cinema')
    .order('updated_at', { ascending: false })
    .limit(12);

  const progress = (data ?? []) as WatchProgress[];

  if (progress.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Здесь появятся фильмы и сериалы, которые вы смотрите. Начните с
        популярного ниже.
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

async function Popular() {
  try {
    const items = await getPopularCinema(18);
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
          Каталог кино недоступен. Убедитесь, что задан{' '}
          <code className="rounded bg-black/30 px-1">VIDEOSEED_API_TOKEN</code>{' '}
          — по нему подтягиваются фильмы и сериалы из Videoseed.
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <CinemaCard key={item.id} item={item} />
        ))}
      </div>
    );
  } catch {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Videoseed. Попробуйте обновить страницу позже.
      </div>
    );
  }
}

export default function CinemaHomePage() {
  return (
    <div className="flex flex-col gap-10">
      <ModeSwitch active="cinema" />

      <section className="animate-rise flex flex-col gap-4">
        <h1 className="text-xl font-bold">Продолжить просмотр</h1>
        <Suspense fallback={<CardGridSkeleton count={4} />}>
          <ContinueWatching />
        </Suspense>
      </section>

      <section
        className="animate-rise flex flex-col gap-4"
        style={{ animationDelay: '80ms' }}
      >
        <h2 className="text-xl font-bold">Новинки</h2>
        <Suspense fallback={<CardGridSkeleton count={18} />}>
          <Popular />
        </Suspense>
      </section>
    </div>
  );
}
