import ContinueCard from '@/components/ContinueCard';
import LoginBanner from '@/components/LoginBanner';
import type { ContinueEntry } from '@/components/ContinueCarousel';

const GRID_LIMIT = 9;

/**
 * «Продолжить просмотр» на всю ширину, когда hero не отрисовался (данных
 * ещё нет — см. getHeroPick/hero_pick). Узкая боковая панель
 * (ContinueWatchingPanel, 3 строки с пагинацией) в такой раскладке заняла
 * бы только четверть строки рядом с пустотой, поэтому вместо неё — сетка
 * из полноразмерных плиток (ContinueCard, те же, что раньше были в
 * горизонтальной карусели) на всю ширину.
 *
 * Без пагинации: 9 плиток и так укладываются без скролла на большинстве
 * экранов, а особый случай ради одного временного состояния (данных для
 * hero ещё нет) того не стоит.
 */
export default function ContinueWatchingGrid({
  entries,
  loggedIn,
}: {
  entries: ContinueEntry[];
  loggedIn: boolean;
}) {
  if (!loggedIn) return <LoginBanner />;

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-card p-6 text-sm text-gray-400 ring-1 ring-inset ring-white/5">
        Здесь появятся тайтлы, которые вы смотрите. Начните с популярного ниже.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {entries.slice(0, GRID_LIMIT).map((entry) => (
        <ContinueCard
          key={entry.progress.id}
          progress={entry.progress}
          isMultiSeason={entry.isMultiSeason}
          localPoster={entry.localPoster}
        />
      ))}
    </div>
  );
}
