import AnimeCard from '@/components/AnimeCard';
import { getPrequels, getSequels, getSimilarAnime } from '@/lib/shikimori';

/**
 * Приквел/сиквел/похожее — общая для страницы тайтла (anime/[shikimoriId])
 * и страницы просмотра (watch/[shikimoriId]/[episode]): франшизная
 * навигация и рекомендации, три отдельных похода к Shikimori API, ничего из
 * этого не нужно для показа самого плеера/шапки тайтла. Рендерится в своём
 * Suspense у вызывающей страницы — стримится отдельным чанком, не блокируя
 * критичный контент (см. коммит, который вынес это с watch-страницы: там
 * это раньше блокировало САМ ПЛЕЕР).
 */
export async function RelatedAnimeSections({
  id,
  compact = false,
  similarLimit = 12,
}: {
  id: number;
  /** Компактный вид — секции с верхней рамкой-разделителем и заголовком
   *  поменьше, под плеером на watch-странице, а не как полноценные секции
   *  страницы тайтла. */
  compact?: boolean;
  similarLimit?: number;
}) {
  const [prequels, sequels, similar] = await Promise.all([
    getPrequels(id),
    getSequels(id),
    getSimilarAnime(id, similarLimit),
  ]);

  if (prequels.length === 0 && sequels.length === 0 && similar.length === 0) {
    return null;
  }

  const sectionClass = compact
    ? 'flex flex-col gap-3 border-t border-white/5 pt-4'
    : 'flex flex-col gap-3';
  const headingClass = compact ? 'text-base font-semibold' : 'text-lg font-semibold';

  return (
    <>
      {prequels.length > 0 && (
        <section className={sectionClass}>
          <h2 className={headingClass}>Предыдущий сезон</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {prequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {sequels.length > 0 && (
        <section className={sectionClass}>
          <h2 className={headingClass}>Продолжение</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {sequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section className={sectionClass}>
          <h2 className={headingClass}>Похожее</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {similar.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function RelatedAnimeSectionsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <section
      className={
        compact
          ? 'flex flex-col gap-3 border-t border-white/5 pt-4'
          : 'flex flex-col gap-3'
      }
    >
      <div className="skeleton h-6 w-32 rounded-md" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="skeleton aspect-[2/3] w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}
