import { notFound } from 'next/navigation';
import AnimeCard from '@/components/AnimeCard';
import Pagination from '@/components/Pagination';
import { getStudio, type StudioOrder } from '@/lib/shikimoriCredits';

const ORDER_LABELS: Record<StudioOrder, string> = {
  popularity: 'По популярности',
  ranked: 'По рейтингу',
  aired_on: 'По дате выхода',
};

const PAGE_SIZE = 24;

function isStudioOrder(value: string | undefined): value is StudioOrder {
  return value === 'popularity' || value === 'ranked' || value === 'aired_on';
}

function hrefFor(studioId: number, page: number, order: StudioOrder): string {
  return `/company/shikimori/${studioId}?page=${page}&order=${order}`;
}

/**
 * Страница студии (см. ТЗ). `source` пока только 'shikimori' — см.
 * app/person/[source]/[id]/page.tsx, та же причина. У Shikimori нет
 * /studios/:id и нет общего счётчика тайтлов студии — пагинация поэтому
 * без номера последней страницы, только «след./пред.» (см. Pagination).
 */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: { source: string; id: string };
  searchParams: { page?: string; order?: string };
}) {
  if (params.source !== 'shikimori') notFound();
  const studioId = Number(params.id);
  if (!Number.isFinite(studioId)) notFound();

  const page = Math.max(1, Number(searchParams.page) || 1);
  const order = isStudioOrder(searchParams.order) ? searchParams.order : 'popularity';

  const studio = await getStudio(studioId, { page, order });
  if (!studio) notFound();

  const prevHref = page > 1 ? hrefFor(studioId, page - 1, order) : null;
  const nextHref = studio.animes.length >= PAGE_SIZE ? hrefFor(studioId, page + 1, order) : null;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5">
          {studio.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={studio.imageUrl}
              alt={studio.name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain p-2"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-500">Нет лого</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
          <h1 className="max-w-full text-3xl font-bold leading-tight [overflow-wrap:anywhere]">{studio.name}</h1>
          <p className="text-sm text-gray-400">Студия анимации</p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Тайтлы</h2>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ORDER_LABELS) as StudioOrder[]).map((o) => (
              <a
                key={o}
                href={hrefFor(studioId, 1, o)}
                className={`press rounded-md px-2 py-1 text-xs transition ${
                  o === order
                    ? 'bg-accent/20 text-accent-text'
                    : 'bg-bg-card text-gray-300 hover:bg-accent/15 hover:text-accent-text'
                }`}
              >
                {ORDER_LABELS[o]}
              </a>
            ))}
          </div>
        </div>

        {studio.animes.length === 0 ? (
          <p className="text-sm text-gray-400">На этой странице тайтлов не нашлось.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {studio.animes.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        )}

        {(prevHref || nextHref) && <Pagination page={page} prevHref={prevHref} nextHref={nextHref} />}
      </section>
    </div>
  );
}
