import { Suspense } from 'react';
import ContinueCard from '@/components/ContinueCard';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import NavTile from '@/components/NavTile';
import { CardGridSkeleton } from '@/components/Skeletons';
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
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
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

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <ModeSwitch active="anime" />

      <section className="animate-rise flex flex-col gap-4">
        <h1 className="text-xl font-bold">Продолжить просмотр</h1>
        <Suspense fallback={<CardGridSkeleton count={4} />}>
          <ContinueWatching />
        </Suspense>
      </section>

      <section
        className="animate-rise grid grid-cols-1 gap-4 sm:grid-cols-3"
        style={{ animationDelay: '80ms' }}
      >
        <NavTile
          href="/popular"
          icon="🔥"
          title="Популярное"
          description="Топ аниме по рейтингу"
        />
        <NavTile
          href="/new"
          icon="🆕"
          title="Новинки"
          description="Последние вышедшие тайтлы"
        />
        <NavTile
          href="/catalog"
          icon="🔎"
          title="Каталог"
          description="Поиск по жанрам и фильтрам"
        />
      </section>
    </div>
  );
}
