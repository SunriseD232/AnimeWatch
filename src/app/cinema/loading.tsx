import { CardGridSkeleton, CarouselSkeleton } from '@/components/Skeletons';

/**
 * Скелетон главной. Повторяет её раскладку: переключатель разделов, ряд
 * «Продолжить просмотр», вкладки и сетка подборки — чтобы при переходе
 * между разделами страница не мигала пустотой и не прыгала, когда данные
 * доедут.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-10">
      <div className="skeleton h-11 w-72 rounded-full" />

      <section className="flex flex-col gap-4">
        <div className="skeleton h-6 w-52" />
        <CarouselSkeleton count={4} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="skeleton h-8 w-64 rounded-full" />
        <CardGridSkeleton count={12} />
      </section>
    </div>
  );
}
