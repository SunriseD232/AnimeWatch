import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import ContinueCard from '@/components/ContinueCard';
import LoginBanner from '@/components/LoginBanner';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getPopular } from '@/lib/shikimori';
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

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
      {progress.map((p) => (
        <ContinueCard key={p.id} progress={p} />
      ))}
    </div>
  );
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

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Продолжить просмотр</h1>
        <Suspense fallback={<CardGridSkeleton count={4} />}>
          <ContinueWatching />
        </Suspense>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">Популярное сейчас</h2>
        <Suspense fallback={<CardGridSkeleton count={18} />}>
          <Popular />
        </Suspense>
      </section>
    </div>
  );
}
