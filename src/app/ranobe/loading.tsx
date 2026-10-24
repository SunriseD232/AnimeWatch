import { CardGridSkeleton } from '@/components/Skeletons';

// Раздел ходит в индекс и (при поиске) к источнику — без заглушки переход
// сюда несколько секунд ничего не менял на экране.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-4 w-full max-w-xl" />
      </div>
      <div className="skeleton h-11 w-full rounded-full" />
      <CardGridSkeleton count={12} />
    </div>
  );
}
