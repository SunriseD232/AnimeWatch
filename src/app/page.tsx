import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import ContinueCard from '@/components/ContinueCard';
import DiscoverTabs from '@/components/DiscoverTabs';
import LoginBanner from '@/components/LoginBanner';
import ModeSwitch from '@/components/ModeSwitch';
import Pagination from '@/components/Pagination';
import PlannedCard from '@/components/PlannedCard';
import ScrollCarousel from '@/components/ScrollCarousel';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getAnime, getNewAnime, getPopularRanked } from '@/lib/shikimori';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';

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

  const items = (data ?? []) as WatchProgress[];

  // Убираем из карусели то, что уже отмечено «Просмотрено» в списке — но
  // ТОЛЬКО если аниме реально закончилось. Онгоинг никогда не трогаем: если
  // просто дошёл до последней вышедшей на сегодня серии, статус мог стать
  // completed автоматически (см. onEnded в WatchPlayer.tsx), а карточка
  // всё равно должна остаться — новая серия выйдет, и надо куда вернуться.
  // Не смогли проверить статус (Shikimori недоступен и т.п.) — не скрываем,
  // безопасный дефолт в пользу лишней карточки, а не потерянного онгоинга.
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
    .eq('content_type', 'anime')
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
              contentType="anime"
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
  const progressMap = await getEpisodeProgressMap('anime', data.items.map((a) => a.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((a) => (
          <AnimeCard key={a.id} anime={a} currentEpisode={progressMap.get(a.id) ?? null} />
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

      {/* Пустой список (гость/нет planned-тайтлов) — PlannedCarousel сам
          вернёт null, секция не появится вообще, скелетон тут ни к чему. */}
      <Suspense fallback={null}>
        <PlannedCarousel />
      </Suspense>

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
