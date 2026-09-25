import ContinueCarousel from '@/components/ContinueCarousel';
import LoginBanner from '@/components/LoginBanner';
import type { ContinueEntry } from '@/components/ContinueCarousel';

/**
 * «Продолжить просмотр» на всю ширину, когда hero не отрисовался (данных
 * ещё нет — см. getHeroPick/hero_pick). Узкая боковая панель
 * (ContinueWatchingPanel, 3 строки с пагинацией) в такой раскладке заняла
 * бы только четверть строки рядом с пустотой, поэтому вместо неё —
 * прежняя горизонтальная карусель широких карточек (ContinueCarousel), но
 * на всю ширину страницы вместо колонки 360px.
 */
export default function ContinueWatchingFull({
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

  return <ContinueCarousel entries={entries} />;
}
