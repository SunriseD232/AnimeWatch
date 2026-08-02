import Link from 'next/link';
import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import ContinueCard from '@/components/ContinueCard';
import DiscoverTabs from '@/components/DiscoverTabs';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getNewCinema, getPopularCinemaRanked } from '@/lib/videoseed-catalog';
import { createClient } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Фильмы и сериалы — MediaWatch' };

const DISCOVER_TABS = [
  { key: 'new', label: 'Новинки', href: '/cinema?tab=new' },
  { key: 'popular', label: 'Популярное', href: '/cinema?tab=popular' },
];
const DISCOVER_PAGE_SIZE = 16;

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
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Здесь появятся фильмы и сериалы, которые вы смотрите. Начните с
        популярного ниже.
      </div>
    );
  }

  // Горизонтальная карусель: последние просмотренные листаются вбок.
  // Помимо родной полосы прокрутки — колесо мыши и драг (см. ScrollCarousel).
  return (
    <ScrollCarousel className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {progress.map((p) => (
        <div key={p.id} className="w-56 shrink-0 snap-start sm:w-72">
          <ContinueCard progress={p} />
        </div>
      ))}
    </ScrollCarousel>
  );
}

/** Новинки/Популярное — карусель на главной под «Продолжить просмотр»,
 *  переключается вкладками DiscoverTabs (см. searchParams.tab в CinemaHomePage). */
async function DiscoverCarousel({ tab }: { tab: string }) {
  let data;
  try {
    data =
      tab === 'popular'
        ? await getPopularCinemaRanked(1, DISCOVER_PAGE_SIZE)
        : await getNewCinema(1, DISCOVER_PAGE_SIZE);
  } catch {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Videoseed. Попробуйте обновить страницу
        позже.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Каталог кино недоступен. Убедитесь, что задан{' '}
        <code className="rounded bg-black/30 px-1">VIDEOSEED_API_TOKEN</code>.
      </div>
    );
  }

  const seeAllHref = tab === 'popular' ? '/cinema/popular' : '/cinema/new';

  return (
    <ScrollCarousel className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {data.items.map((item) => (
        <div key={item.id} className="w-40 shrink-0 snap-start sm:w-48">
          <CinemaCard item={item} />
        </div>
      ))}
      <Link
        href={seeAllHref}
        className="flex w-40 shrink-0 snap-start items-center justify-center rounded-2xl bg-bg-card text-sm font-medium text-gray-300 ring-1 ring-white/5 transition hover:text-accent hover:ring-accent/60 sm:w-48"
      >
        Смотреть все →
      </Link>
    </ScrollCarousel>
  );
}

export default function CinemaHomePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab === 'popular' ? 'popular' : 'new';

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
        <DiscoverTabs tabs={DISCOVER_TABS} activeKey={tab} catalogHref="/cinema/catalog" />
        <Suspense key={tab} fallback={<CardGridSkeleton count={6} />}>
          <DiscoverCarousel tab={tab} />
        </Suspense>
      </section>
    </div>
  );
}
