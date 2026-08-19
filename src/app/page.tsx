import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import ContinueCard from '@/components/ContinueCard';
import DiscoverTabs from '@/components/DiscoverTabs';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import Pagination from '@/components/Pagination';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getNewAnime, getPopularRanked } from '@/lib/shikimori';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

const DISCOVER_TABS = [
  { key: 'new', label: 'Новинки', href: '/?tab=new' },
  { key: 'popular', label: 'Популярное', href: '/?tab=popular' },
];
const DISCOVER_PAGE_SIZE = 24;

function discoverPageHref(tab: string, showAnons: boolean, page: number): string {
  const params = new URLSearchParams();
  if (tab !== 'new') params.set('tab', tab);
  if (showAnons) params.set('anons', '1');
  params.set('page', String(page));
  return `/?${params.toString()}`;
}

async function ContinueWatching() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

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
 *  searchParams.tab в HomePage) — тот же грид, что у /new и /catalog. */
async function DiscoverGrid({
  tab,
  showAnons,
  page,
}: {
  tab: string;
  showAnons: boolean;
  page: number;
}) {
  let data;
  try {
    data =
      tab === 'popular'
        ? await getPopularRanked(page, DISCOVER_PAGE_SIZE, !showAnons)
        : await getNewAnime(page, DISCOVER_PAGE_SIZE, !showAnons);
  } catch {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Shikimori. Попробуйте обновить страницу
        позже.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1 ? 'Дальше ничего нет.' : 'Пока ничего нет.'}
      </div>
    );
  }

  const hasPrev = page > 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={hasPrev ? discoverPageHref(tab, showAnons, page - 1) : null}
        nextHref={data.hasMore ? discoverPageHref(tab, showAnons, page + 1) : null}
      />
    </div>
  );
}

export default function HomePage({
  searchParams,
}: {
  searchParams: { tab?: string; anons?: string; page?: string };
}) {
  const tab = searchParams.tab === 'popular' ? 'popular' : 'new';
  const showAnons = searchParams.anons === '1';
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

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
        className="animate-rise flex flex-col gap-4"
        style={{ animationDelay: '80ms' }}
      >
        <DiscoverTabs
          tabs={DISCOVER_TABS}
          activeKey={tab}
          catalogHref="/catalog"
          anonsToggle
          showAnons={showAnons}
        />
        <Suspense
          key={`${tab}|${showAnons}|${page}`}
          fallback={<CardGridSkeleton count={DISCOVER_PAGE_SIZE} />}
        >
          <DiscoverGrid tab={tab} showAnons={showAnons} page={page} />
        </Suspense>
      </section>
    </div>
  );
}
