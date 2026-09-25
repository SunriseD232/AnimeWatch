import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import CatalogTeaser from '@/components/CatalogTeaser';
import ContinueWatchingPanel from '@/components/ContinueWatchingPanel';
import ContinueWatchingFull from '@/components/ContinueWatchingFull';
import type { ContinueEntry } from '@/components/ContinueCarousel';
import HeroBanner from '@/components/HeroBanner';
import ModeSwitch from '@/components/ModeSwitch';
import PlannedCard from '@/components/PlannedCard';
import RecommendedCarousel from '@/components/RecommendedCarousel';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CarouselSkeleton } from '@/components/Skeletons';
import { getAnime } from '@/lib/shikimori';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { getHeroPick, getRecommendedAnime } from '@/lib/recommendations';
import { getLocalPosterMap } from '@/lib/posterCacheServer';

async function getContinueEntries(): Promise<{ loggedIn: boolean; entries: ContinueEntry[] }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) return { loggedIn: false, entries: [] };

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'anime')
    .order('updated_at', { ascending: false })
    .limit(12);

  const items = (data ?? []) as WatchProgress[];

  // Убираем из панели то, что уже отмечено «Просмотрено» в списке — но
  // ТОЛЬКО если аниме реально закончилось (см. прежнюю логику ContinueWatching
  // на этой странице — поведение не меняется, меняется только вёрстка).
  let progress = items;
  if (items.length > 0) {
    const ids = items.map((p) => p.shikimori_id);
    const { data: listRows } = await supabase
      .from('user_list')
      .select('shikimori_id, status')
      .eq('content_type', 'anime')
      .in('shikimori_id', ids);
    const statusById = new Map((listRows ?? []).map((r) => [r.shikimori_id, r.status]));

    progress = (
      await Promise.all(
        items.map(async (p) => {
          if (statusById.get(p.shikimori_id) !== 'completed') return p;
          const anime = await getAnime(p.shikimori_id).catch(() => null);
          if (!anime) return p;
          return anime.status === 'ongoing' ? p : null;
        }),
      )
    ).filter((p): p is WatchProgress => p !== null);
  }

  if (progress.length === 0) return { loggedIn: true, entries: [] };

  const localPosters = await getLocalPosterMap(
    progress.map((p) => ({ kind: 'anime' as const, id: p.shikimori_id })),
  );

  return {
    loggedIn: true,
    entries: progress.map((p) => ({
      progress: p,
      isMultiSeason: false,
      localPoster: localPosters.get(`anime:${p.shikimori_id}`) ?? null,
    })),
  };
}

/**
 * Hero и «Продолжить просмотр» решаются вместе, одним запросом за hero:
 * без него панели на 360px рядом с пустой левой колонкой не место — вместо
 * неё «Продолжить просмотр» растягивается на всю ширину прежней
 * горизонтальной каруселью (см. ContinueWatchingFull). Пока hero не
 * посчитан ни разу (крон рекомендаций ещё не прогонялся) это состояние —
 * не ошибка, а обычный переходный момент.
 */
async function HeroAndContinueRow() {
  const {
    data: { user },
  } = await getCachedUser();
  const [hero, { loggedIn, entries }] = await Promise.all([
    getHeroPick(user?.id ?? null, 'anime'),
    getContinueEntries(),
  ]);

  if (hero) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px] lg:items-stretch">
        <HeroBanner hero={hero}>
          <ModeSwitch active="anime" />
        </HeroBanner>
        <ContinueWatchingPanel entries={entries} loggedIn={loggedIn} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ModeSwitch active="anime" />
      <ContinueWatchingFull entries={entries} loggedIn={loggedIn} />
    </div>
  );
}

async function RecommendedSection() {
  const {
    data: { user },
  } = await getCachedUser();
  const items = await getRecommendedAnime(user?.id ?? null);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Рекомендуем посмотреть</h2>
      <RecommendedCarousel contentType="anime" items={items} />
    </section>
  );
}

/** «Вы хотели посмотреть» — тайтлы со статусом planned в списке
 *  пользователя. Возвращает null (секция целиком не рендерится), если
 *  список пуст или гость — не хотим показывать пустой заголовок. */
async function PlannedCarousel() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_list')
    .select('*')
    .eq('content_type', 'anime')
    .eq('status', 'planned')
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) console.error('[PlannedCarousel] запрос упал:', error.message);

  const items = (data ?? []) as UserListItem[];
  if (items.length === 0) return null;

  const localPosters = await getLocalPosterMap(
    items.map((i) => ({ kind: 'anime' as const, id: i.shikimori_id })),
  );

  return (
    <section className="animate-rise flex flex-col gap-4" style={{ animationDelay: '40ms' }}>
      <h2 className="text-xl font-bold">Вы хотели посмотреть</h2>
      <ScrollCarousel className="carousel-room flex snap-x gap-3 overflow-x-auto">
        {items.map((i) => (
          <div key={i.id} className="w-28 shrink-0 snap-start sm:w-[134px]">
            <PlannedCard
              contentType="anime"
              shikimoriId={i.shikimori_id}
              title={i.anime_title}
              posterUrl={i.poster_url}
              localPoster={localPosters.get(`anime:${i.shikimori_id}`) ?? null}
            />
          </div>
        ))}
      </ScrollCarousel>
    </section>
  );
}

export default function HomePage({
  searchParams,
}: {
  searchParams: { tab?: string; anons?: string; page?: string };
}) {
  // Старая главная держала полную пагинируемую сетку прямо здесь (?tab=/
  // ?page=) — новый дизайн заменил её тизером на /catalog (см. план
  // редизайна), поэтому старые ссылки уводим на эквивалентную сортировку
  // полного каталога, без номера страницы (каталог сам стартует с первой).
  if (searchParams.tab) {
    const params = new URLSearchParams();
    params.set('sort', searchParams.tab === 'popular' ? 'popularity' : 'aired_on');
    if (searchParams.anons === '1') params.set('anons', '1');
    redirect(`/catalog?${params.toString()}`);
  }

  const tab = searchParams.tab === 'popular' ? 'popular' : 'new';

  return (
    <div className="flex flex-col gap-10">
      {/* Заголовок страницы — только для скринридера, см. прежнее обоснование:
          первым видимым текстом теперь оказывается название hero-тайтла, а
          это промо-карточка, не заголовок страницы. */}
      <h1 className="sr-only">Аниме — MediaWatch</h1>

      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px] lg:items-stretch">
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
        <CatalogTeaser contentType="anime" tab={tab} />
      </Suspense>
    </div>
  );
}
