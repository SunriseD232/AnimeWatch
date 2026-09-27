import { notFound } from 'next/navigation';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import Pagination from '@/components/Pagination';
import { getStudio, type StudioOrder } from '@/lib/shikimoriCredits';
import {
  getTmdbCompany,
  getTmdbCompanyDiscoverPage,
  tmdbImageUrl,
  type CompanyMediaType,
} from '@/lib/tmdbCredits';
import { getCinemaIndexByIds, getKpIdsByTmdbIds } from '@/lib/cinemaIndexQuery';

const ORDER_LABELS: Record<StudioOrder, string> = {
  popularity: 'По популярности',
  ranked: 'По рейтингу',
  aired_on: 'По дате выхода',
};

const PAGE_SIZE = 24;
/** Размер страницы TMDB discover — фиксирован апстримом, не наш выбор. */
const TMDB_DISCOVER_PAGE_SIZE = 20;

function isStudioOrder(value: string | undefined): value is StudioOrder {
  return value === 'popularity' || value === 'ranked' || value === 'aired_on';
}

function hrefFor(studioId: number, page: number, order: StudioOrder): string {
  return `/company/shikimori/${studioId}?page=${page}&order=${order}`;
}

async function ShikimoriCompanySection({
  studioId,
  searchParams,
}: {
  studioId: number;
  searchParams: { page?: string; order?: string };
}) {
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

const MEDIA_TYPE_LABELS: Record<CompanyMediaType, string> = { movie: 'Фильмы', tv: 'Сериалы' };

function tmdbHrefFor(companyId: number, page: number, mediaType: CompanyMediaType): string {
  return `/company/tmdb/${companyId}?page=${page}&type=${mediaType}`;
}

async function TmdbCompanySection({
  companyId,
  searchParams,
}: {
  companyId: number;
  searchParams: { page?: string; type?: string };
}) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const mediaType: CompanyMediaType = searchParams.type === 'tv' ? 'tv' : 'movie';

  const company = await getTmdbCompany(companyId);
  if (!company) notFound();

  // Компания у TMDB своей фильмографии одним запросом не отдаёт (в отличие
  // от студии Shikimori — там хотя бы поиск по параметру studio=) — только
  // discover с фильтром по компании, обычная постраничная выдача. Дальше —
  // тот же резолв TMDB id → kp_id, что и на странице персоны: показываем
  // только то, что реально есть в каталоге сайта.
  const discover = await getTmdbCompanyDiscoverPage(companyId, { mediaType, page });
  const tmdbIds = discover.map((d) => d.tmdbId);
  const kpByTmdb = await getKpIdsByTmdbIds(tmdbIds);
  const kpIds = [...new Set([...kpByTmdb.values()])];
  const items = await getCinemaIndexByIds(kpIds);
  const itemByKpId = new Map(items.map((i) => [i.id, i]));
  const matched = tmdbIds
    .map((id) => {
      const kpId = kpByTmdb.get(id);
      return kpId != null ? itemByKpId.get(kpId) : undefined;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const prevHref = page > 1 ? tmdbHrefFor(companyId, page - 1, mediaType) : null;
  const nextHref = discover.length >= TMDB_DISCOVER_PAGE_SIZE ? tmdbHrefFor(companyId, page + 1, mediaType) : null;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5">
          {tmdbImageUrl(company.logoPath, 'w300') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tmdbImageUrl(company.logoPath, 'w300') as string}
              alt={company.name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain p-2"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-500">Нет лого</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
          <h1 className="max-w-full text-3xl font-bold leading-tight [overflow-wrap:anywhere]">{company.name}</h1>
          {company.originCountry && <p className="text-sm text-gray-400">{company.originCountry}</p>}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Тайтлы</h2>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MEDIA_TYPE_LABELS) as CompanyMediaType[]).map((t) => (
              <a
                key={t}
                href={tmdbHrefFor(companyId, 1, t)}
                className={`press rounded-md px-2 py-1 text-xs transition ${
                  t === mediaType
                    ? 'bg-accent/20 text-accent-text'
                    : 'bg-bg-card text-gray-300 hover:bg-accent/15 hover:text-accent-text'
                }`}
              >
                {MEDIA_TYPE_LABELS[t]}
              </a>
            ))}
          </div>
        </div>

        {matched.length === 0 ? (
          <p className="text-sm text-gray-400">
            На этой странице нет тайтлов, доступных в каталоге сайта.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {matched.map((item) => (
              <CinemaCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {(prevHref || nextHref) && <Pagination page={page} prevHref={prevHref} nextHref={nextHref} />}
      </section>
    </div>
  );
}

/**
 * Страница студии/компании (см. ТЗ). `source` различает Shikimori (студии
 * анимации, фаза 1) и TMDB (продакшны/дистрибьюторы кино, фаза 2) — см.
 * app/person/[source]/[id]/page.tsx, та же причина разделения.
 */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: { source: string; id: string };
  searchParams: { page?: string; order?: string; type?: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  if (params.source === 'shikimori') return <ShikimoriCompanySection studioId={id} searchParams={searchParams} />;
  if (params.source === 'tmdb') return <TmdbCompanySection companyId={id} searchParams={searchParams} />;
  notFound();
}
