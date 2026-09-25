import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import CatalogTeaser from '@/components/CatalogTeaser';
import type { ContinueEntry } from '@/components/ContinueCarousel';
import ContinueWatchingPanel from '@/components/ContinueWatchingPanel';
import ContinueWatchingGrid from '@/components/ContinueWatchingGrid';
import HeroBanner from '@/components/HeroBanner';
import ModeSwitch from '@/components/ModeSwitch';
import PlannedCard from '@/components/PlannedCard';
import RecommendedCarousel from '@/components/RecommendedCarousel';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CarouselSkeleton } from '@/components/Skeletons';
import { getCinemaById, getCinemaSeasonCountMap } from '@/lib/videoseed-catalog';
import { getTmdbSeriesOngoing } from '@/lib/tmdb';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { getHeroPick, getRecommendedCinema } from '@/lib/recommendations';
import { getLocalPosterMap } from '@/lib/posterCacheServer';

export const metadata = { title: 'Фильмы и сериалы — MediaWatch' };

async function getContinueEntries(): Promise<{ loggedIn: boolean; entries: ContinueEntry[] }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) return { loggedIn: false, entries: [] };

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'cinema')
    .order('updated_at', { ascending: false })
    .limit(12);

  const items = (data ?? []) as WatchProgress[];

  // Та же логика, что была в прежней ContinueWatching (см. историю
  // страницы): фильмы-«просмотрено» скрываем сразу, сериалы — только если
  // TMDB подтвердил, что они реально завершены (см. getTmdbSeriesOngoing).
  let progress = items;
  if (items.length > 0) {
    const ids = items.map((p) => p.shikimori_id);
    const { data: listRows } = await supabase
      .from('user_list')
      .select('shikimori_id, status')
      .eq('content_type', 'cinema')
      .in('shikimori_id', ids);
    const statusById = new Map((listRows ?? []).map((r) => [r.shikimori_id, r.status]));

    progress = (
      await Promise.all(
        items.map(async (p) => {
          if (statusById.get(p.shikimori_id) !== 'completed') return p;
          const full = await getCinemaById(p.shikimori_id).catch(() => null);
          if (!full?.isSerial) return null;
          if (!full.idImdb) return p;
          const ongoing = await getTmdbSeriesOngoing(full.idImdb);
          return ongoing === false ? null : p;
        }),
      )
    ).filter((p): p is WatchProgress => p !== null);
  }

  if (progress.length === 0) return { loggedIn: true, entries: [] };

  const seasonCountMap = await getCinemaSeasonCountMap(progress.map((p) => p.shikimori_id));
  const localPosters = await getLocalPosterMap(
    progress.map((p) => ({ kind: 'cinema' as const, id: p.shikimori_id })),
  );

  return {
    loggedIn: true,
    entries: progress.map((p) => ({
      progress: p,
      isMultiSeason: (seasonCountMap.get(p.shikimori_id) ?? 0) > 1,
      localPoster: localPosters.get(`cinema:${p.shikimori_id}`) ?? null,
    })),
  };
}

/** См. HomePage ('/') — HeroAndContinueRow. */
async function HeroAndContinueRow() {
  const {
    data: { user },
  } = await getCachedUser();
  const [hero, { loggedIn, entries }] = await Promise.all([
    getHeroPick(user?.id ?? null, 'cinema'),
    getContinueEntries(),
  ]);

  if (hero) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-stretch">
        <HeroBanner hero={hero}>
          <ModeSwitch active="cinema" />
        </HeroBanner>
        <ContinueWatchingPanel entries={entries} loggedIn={loggedIn} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ModeSwitch active="cinema" />
      <ContinueWatchingGrid entries={entries} loggedIn={loggedIn} />
    </div>
  );
}

async function RecommendedSection() {
  const {
    data: { user },
  } = await getCachedUser();
  const items = await getRecommendedCinema(user?.id ?? null);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Рекомендуем посмотреть</h2>
      <RecommendedCarousel contentType="cinema" items={items} />
    </section>
  );
}

/** «Вы хотели посмотреть» — без изменений от прежней реализации. */
async function PlannedCarousel() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const { data } = await supabase
    .from('user_list')
    .select('*')
    .eq('content_type', 'cinema')
    .eq('status', 'planned')
    .order('created_at', { ascending: false })
    .limit(12);

  const items = (data ?? []) as UserListItem[];
  if (items.length === 0) return null;

  const localPosters = await getLocalPosterMap(
    items.map((i) => ({ kind: 'cinema' as const, id: i.shikimori_id })),
  );

  return (
    <section className="animate-rise flex flex-col gap-4" style={{ animationDelay: '40ms' }}>
      <h2 className="text-xl font-bold">Вы хотели посмотреть</h2>
      <ScrollCarousel className="carousel-room flex snap-x gap-3 overflow-x-auto">
        {items.map((i) => (
          <div key={i.id} className="w-28 shrink-0 snap-start sm:w-[134px]">
            <PlannedCard
              contentType="cinema"
              shikimoriId={i.shikimori_id}
              title={i.anime_title}
              posterUrl={i.poster_url}
              localPoster={localPosters.get(`cinema:${i.shikimori_id}`) ?? null}
            />
          </div>
        ))}
      </ScrollCarousel>
    </section>
  );
}

export default function CinemaHomePage({
  searchParams,
}: {
  searchParams: { tab?: string; page?: string };
}) {
  // См. HomePage ('/') — та же замена полной сетки тизером, тот же редирект
  // старых ссылок на полный каталог.
  if (searchParams.tab) {
    const params = new URLSearchParams();
    params.set('sort', searchParams.tab === 'popular' ? 'popularity' : 'new');
    redirect(`/cinema/catalog?${params.toString()}`);
  }

  const tab = searchParams.tab === 'popular' ? 'popular' : 'new';

  return (
    <div className="flex flex-col gap-10">
      <h1 className="sr-only">Фильмы и сериалы — MediaWatch</h1>

      <Suspense
        fallback={
          <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-stretch">
            <div className="skeleton h-[52vh] min-h-[320px] max-h-[420px] rounded-3xl lg:h-[440px] lg:max-h-none" />
            <div className="skeleton h-[220px] rounded-3xl lg:h-[440px]" />
          </div>
        }
      >
        <HeroAndContinueRow />
      </Suspense>

      <Suspense fallback={<CarouselSkeleton count={6} wide={false} />}>
        <RecommendedSection />
      </Suspense>

      <Suspense fallback={<CarouselSkeleton count={6} wide={false} />}>
        <PlannedCarousel />
      </Suspense>

      <Suspense fallback={<CarouselSkeleton count={6} wide={false} />}>
        <CatalogTeaser contentType="cinema" tab={tab} />
      </Suspense>
    </div>
  );
}
