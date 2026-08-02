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
const DISCOVER_PAGE_SIZE = 24;

function discoverPageHref(tab: string, page: number): string {
  const params = new URLSearchParams();
  if (tab !== 'new') params.set('tab', tab);
  params.set('page', String(page));
  return `/cinema?${params.toString()}`;
}

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

/** Новинки/Популярное — полноценная сетка с пагинацией на главной под
 *  «Продолжить просмотр», переключается вкладками DiscoverTabs (см.
 *  searchParams.tab в CinemaHomePage) — тот же грид, что у /cinema/new и
 *  /cinema/catalog. */
async function DiscoverGrid({ tab, page }: { tab: string; page: number }) {
  let data;
  try {
    data =
      tab === 'popular'
        ? await getPopularCinemaRanked(page, DISCOVER_PAGE_SIZE)
        : await getNewCinema(page, DISCOVER_PAGE_SIZE);
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
        {page > 1 ? (
          'Дальше ничего нет.'
        ) : (
          <>
            Каталог кино недоступен. Убедитесь, что задан{' '}
            <code className="rounded bg-black/30 px-1">VIDEOSEED_API_TOKEN</code>.
          </>
        )}
      </div>
    );
  }

  const hasPrev = page > 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((item) => (
          <CinemaCard key={item.id} item={item} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Link
          href={hasPrev ? discoverPageHref(tab, page - 1) : '#'}
          aria-disabled={!hasPrev}
          className={[
            'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            hasPrev
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          ← Пред.
        </Link>
        <span className="px-2 text-sm text-gray-400">Стр. {page}</span>
        <Link
          href={data.hasMore ? discoverPageHref(tab, page + 1) : '#'}
          aria-disabled={!data.hasMore}
          className={[
            'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            data.hasMore
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          След. →
        </Link>
      </div>
    </div>
  );
}

export default function CinemaHomePage({
  searchParams,
}: {
  searchParams: { tab?: string; page?: string };
}) {
  const tab = searchParams.tab === 'popular' ? 'popular' : 'new';
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

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
        <Suspense key={`${tab}|${page}`} fallback={<CardGridSkeleton count={DISCOVER_PAGE_SIZE} />}>
          <DiscoverGrid tab={tab} page={page} />
        </Suspense>
      </section>
    </div>
  );
}
