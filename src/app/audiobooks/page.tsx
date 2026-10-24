import Link from 'next/link';
import { Suspense } from 'react';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import AudiobookCard from '@/components/audiobooks/AudiobookCard';
import AudiobookContinue from '@/components/audiobooks/AudiobookContinue';
import { getAudiobookList } from '@/lib/audiobooks';

export const metadata = { title: 'Аудиокниги — MediaWatch' };

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

/**
 * Раздел «Аудиокниги» (группа «Слушать»). Всё — из своего индекса
 * (audiobook_index, миграция 0064), один SQL на блок:
 *   • поиск по названию и автору (?q=) — по словам, как у книг;
 *   • без запроса — новинки knigavuhe и популярное с пагинацией.
 * Фильтры по жанрам и длительности — в каталоге (/audiobooks/catalog).
 */
export default function AudiobooksPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold">Аудиокниги</h1>
          <Link href="/audiobooks/catalog" className="text-sm font-medium text-accent-text hover:underline">
            Каталог с фильтрами →
          </Link>
        </div>
        <p className="text-sm text-gray-400">
          Озвученные книги с главами и сохранением места. Если у книги есть текст во Флибусте, место
          в книге и в записи можно переносить друг в друга.
        </p>
      </div>

      {/* Обычная форма: поиск работает и без JS, адрес — делимый. */}
      <form action="/audiobooks" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Название или автор"
          aria-label="Поиск аудиокниг"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-bg-card px-4 py-2 text-base text-gray-100 placeholder:text-gray-400 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <button type="submit" className="press rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">
          Найти
        </button>
      </form>

      {!query && page === 1 ? (
        <Suspense fallback={null}>
          <AudiobookContinue />
        </Suspense>
      ) : null}

      <Suspense key={`${query}:${page}`} fallback={<CardGridSkeleton count={12} />}>
        {query ? <SearchResults query={query} page={page} /> : <Showcase page={page} />}
      </Suspense>
    </div>
  );
}

function pageHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/audiobooks?${qs}` : '/audiobooks';
}

async function SearchResults({ query, page }: { query: string; page: number }) {
  const { items, hasMore } = await getAudiobookList({ query, sort: 'popular', page, pageSize: PAGE_SIZE });
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1
          ? 'Дальше результатов нет.'
          : `По запросу «${query}» ничего не нашлось. Попробуйте фамилию автора или часть названия.`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className={GRID}>
        {items.map((item, i) => (
          <AudiobookCard key={item.id} audiobook={item} priority={i < 6} />
        ))}
      </div>
      <Pagination
        page={page}
        prevHref={page > 1 ? pageHref(query, page - 1) : null}
        nextHref={hasMore ? pageHref(query, page + 1) : null}
      />
    </div>
  );
}

async function Showcase({ page }: { page: number }) {
  const [fresh, popular] = await Promise.all([
    page === 1 ? getAudiobookList({ sort: 'new', page: 1, pageSize: 12 }) : Promise.resolve(null),
    getAudiobookList({ sort: 'popular', page, pageSize: PAGE_SIZE }),
  ]);
  if (popular.items.length === 0 && (!fresh || fresh.items.length === 0)) {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Каталог аудиокниг ещё наполняется — загляните через час.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {fresh && fresh.items.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Новинки</h2>
          <div className={GRID}>
            {fresh.items.map((item, i) => (
              <AudiobookCard key={item.id} audiobook={item} priority={i < 6} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Популярное</h2>
        <div className={GRID}>
          {popular.items.map((item) => (
            <AudiobookCard key={item.id} audiobook={item} />
          ))}
        </div>
        <Pagination
          page={page}
          prevHref={page > 1 ? pageHref('', page - 1) : null}
          nextHref={popular.hasMore ? pageHref('', page + 1) : null}
        />
      </section>
    </div>
  );
}
