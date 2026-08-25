import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import ContinueCard from '@/components/ContinueCard';
import DiscoverTabs from '@/components/DiscoverTabs';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import Pagination from '@/components/Pagination';
import PlannedCard from '@/components/PlannedCard';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CardGridSkeleton } from '@/components/Skeletons';
import {
  getCinemaById,
  getCinemaEpisodesTotalMap,
  getNewCinema,
  getPopularCinemaRanked,
} from '@/lib/videoseed-catalog';
import { getTmdbSeriesOngoing } from '@/lib/tmdb';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';

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
  } = await getCachedUser();

  if (!user) {
    return <LoginBanner />;
  }

  const { data } = await supabase
    .from('watch_progress')
    .select('*')
    .eq('content_type', 'cinema')
    .order('updated_at', { ascending: false })
    .limit(12);

  const items = (data ?? []) as WatchProgress[];

  // Убираем то, что отмечено «Просмотрено» — но не сериалы, которые ещё
  // идут (см. getTmdbSeriesOngoing — у Videoseed своего статуса нет, а
  // completed тут ставится ЛЮБОМУ тайтлу, у которого кончился список
  // известных на момент просмотра серий, см. onEnded в Player.tsx: для
  // сериала это могло значить «догнал последнюю вышедшую», а не «сериал
  // закончился насовсем»). Фильмы (не сериалы) скрываем сразу — досмотренный
  // фильм не может «продолжиться». Не смогли проверить статус сериала — не
  // скрываем, безопасный дефолт в пользу лишней карточки.
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

/** «Вы хотели посмотреть» — тайтлы со статусом planned в списке
 *  пользователя. Возвращает null (секция целиком не рендерится), если
 *  список пуст или гость — не хотим показывать пустой заголовок. */
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

  return (
    <section className="animate-rise flex flex-col gap-4" style={{ animationDelay: '40ms' }}>
      <h2 className="text-xl font-bold">Вы хотели посмотреть</h2>
      <ScrollCarousel className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {items.map((i) => (
          <div key={i.id} className="w-40 shrink-0 snap-start sm:w-48">
            <PlannedCard
              contentType="cinema"
              shikimoriId={i.shikimori_id}
              title={i.anime_title}
              posterUrl={i.poster_url}
            />
          </div>
        ))}
      </ScrollCarousel>
    </section>
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
          'Каталог Videoseed сейчас недоступен — попробуйте обновить страницу через минуту.'
        )}
      </div>
    );
  }

  const hasPrev = page > 1;
  const progressMap = await getEpisodeProgressMap('cinema', data.items.map((item) => item.id));
  const episodesTotalMap = await getCinemaEpisodesTotalMap([...progressMap.keys()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((item) => (
          <CinemaCard
            key={item.id}
            item={item}
            currentEpisode={progressMap.get(item.id) ?? null}
            episodesTotal={episodesTotalMap.get(item.id) ?? null}
          />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={hasPrev ? discoverPageHref(tab, page - 1) : null}
        nextHref={data.hasMore ? discoverPageHref(tab, page + 1) : null}
      />
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

      {/* Пустой список (гость/нет planned-тайтлов) — PlannedCarousel сам
          вернёт null, секция не появится вообще, скелетон тут ни к чему. */}
      <Suspense fallback={null}>
        <PlannedCarousel />
      </Suspense>

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
