import Link from 'next/link';
import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import BookCard from '@/components/books/BookCard';
import MangaCard from '@/components/manga/MangaCard';
import RanobeCard from '@/components/ranobe/RanobeCard';
import { searchCinema } from '@/lib/videoseed-catalog';
import { searchAnime } from '@/lib/shikimori';
import { searchAnimeFromIndex } from '@/lib/animeIndexQuery';
import { searchCinemaFromIndex } from '@/lib/cinemaIndexQuery';
import { getSiteRatings } from '@/lib/social/server';
import { getBookCatalog } from '@/lib/books';
import { getMangaCatalog } from '@/lib/manga';
import { getRanobeCatalog } from '@/lib/ranobe';

export const metadata = { title: 'Поиск — MediaWatch' };

type WatchType = 'anime' | 'cinema' | 'all';
type ReadKind = 'books' | 'manga' | 'ranobe';
type ReadType = 'read' | ReadKind;
type SearchType = WatchType | ReadType;

/**
 * Поиск устроен так же, как шапка (ModeSwitch): группа «Смотреть» и группа
 * «Читать», в каждой — «всё сразу» и отдельные разделы. Подкасты здесь не
 * ищутся: у них свой поиск в разделе, а ряд «Слушать» из одной вкладки
 * ничего не добавил бы.
 */
const WATCH_TABS: { value: WatchType; label: string }[] = [
  { value: 'all', label: 'Всё' },
  { value: 'anime', label: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы' },
];

const READ_TABS: { value: ReadType; label: string }[] = [
  { value: 'read', label: 'Всё' },
  { value: 'books', label: 'Книги' },
  { value: 'manga', label: 'Манга' },
  { value: 'ranobe', label: 'Ранобэ' },
];

const READ_KINDS: ReadKind[] = ['books', 'manga', 'ranobe'];

const READ_META: Record<ReadKind, { title: string; section: string; source: string }> = {
  books: { title: 'Книги', section: '/books', source: 'Флибусте' },
  manga: { title: 'Манга', section: '/manga', source: 'Remanga' },
  ranobe: { title: 'Ранобэ', section: '/ranobe', source: 'Renovels' },
};

const SEARCH_NOUNS: Record<SearchType, string> = {
  anime: 'аниме',
  cinema: 'фильмов и сериалов',
  all: 'аниме, фильмов и сериалов',
  read: 'книг, манги и ранобэ',
  books: 'книг',
  manga: 'манги',
  ranobe: 'ранобэ',
};

/** Сколько карточек раздела в общей выдаче «Читать → Всё» (два ряда на ПК). */
const READ_PREVIEW = 12;
/** Страница выдачи отдельного раздела чтения. */
const READ_PAGE_SIZE = 24;

const CARD_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

function isSearchType(value: string | undefined): value is SearchType {
  return value !== undefined && Object.prototype.hasOwnProperty.call(SEARCH_NOUNS, value);
}

function isReadKind(type: SearchType): type is ReadKind {
  return type === 'books' || type === 'manga' || type === 'ranobe';
}

function searchHref(query: string, type: SearchType, page = 1): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  // Аниме — состояние по умолчанию, его в адресе не пишем: так ссылки
  // остаются такими же, какими были до появления общего поиска.
  if (type !== 'anime') params.set('type', type);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

function SearchError() {
  return (
    <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
      Ошибка поиска. Попробуйте ещё раз.
    </p>
  );
}

async function AnimeResults({ query }: { query: string }) {
  try {
    // Сперва локальный индекс: он и быстрее, и переживает опечатки
    // (триграммы, см. миграцию 0034). Вернул null — работаем по-старому.
    const animes = (await searchAnimeFromIndex(query, 20)) ?? (await searchAnime(query, 20));
    if (animes.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          По запросу «{query}» ничего не найдено.{' '}
          <Link href="/catalog" className="text-accent-text hover:underline">
            Посмотрите каталог
          </Link>
        </p>
      );
    }
    return (
      <div className={CARD_GRID}>
        {animes.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>
    );
  } catch (err) {
    console.error(`[search] AnimeResults query=${query} упал:`, err instanceof Error ? err.message : err);
    return <SearchError />;
  }
}

async function CinemaResults({ query }: { query: string }) {
  try {
    const items = (await searchCinemaFromIndex(query, 20)) ?? (await searchCinema(query, 20));
    const siteRatings = await getSiteRatings(
      'cinema',
      items.map((item) => item.id),
    );
    if (items.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          По запросу «{query}» ничего не найдено.{' '}
          <Link href="/cinema/catalog" className="text-accent-text hover:underline">
            Посмотрите каталог
          </Link>
        </p>
      );
    }
    return (
      <div className={CARD_GRID}>
        {items.map((item) => (
          <CinemaCard key={item.id} item={item} siteRating={siteRatings.get(item.id) ?? null} />
        ))}
      </div>
    );
  } catch (err) {
    console.error(`[search] CinemaResults query=${query} упал:`, err instanceof Error ? err.message : err);
    return <SearchError />;
  }
}

/**
 * Поиск по разделам чтения — только по своим индексам (book_index,
 * manga_index, ranobe_index): после полного обхода в них весь каталог
 * источников, и один SQL на раздел быстрее трёх живых запросов к внешним
 * сайтам. Живой поиск источника остаётся в самом разделе — на него ведёт
 * ссылка под выдачей (там найдётся и вышедшее после последнего обхода).
 */
async function readSearch(kind: ReadKind, query: string, page: number, pageSize: number) {
  const params = { query, page, pageSize };
  if (kind === 'books') {
    const { items } = await getBookCatalog(params);
    return items.map((book, i) => <BookCard key={book.id} book={book} priority={i < 6} />);
  }
  if (kind === 'manga') {
    const { items } = await getMangaCatalog(params);
    return items.map((manga, i) => <MangaCard key={manga.id} manga={manga} priority={i < 6} />);
  }
  const { items } = await getRanobeCatalog(params);
  return items.map((ranobe, i) => <RanobeCard key={ranobe.id} ranobe={ranobe} priority={i < 6} />);
}

function SourceLink({ kind, query }: { kind: ReadKind; query: string }) {
  const meta = READ_META[kind];
  return (
    <Link
      href={`${meta.section}?${new URLSearchParams({ q: query }).toString()}`}
      className="w-fit text-sm text-accent-text hover:underline"
    >
      Не нашли? Искать прямо на {meta.source} →
    </Link>
  );
}

/** Одна секция общей выдачи «Читать → Всё»: первые карточки и ссылка на
 *  полную выдачу раздела. Раздел без совпадений не показывается вовсе. */
async function ReadPreview({ kind, query }: { kind: ReadKind; query: string }) {
  try {
    const cards = await readSearch(kind, query, 1, READ_PREVIEW);
    if (cards.length === 0) return null;
    return (
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">{READ_META[kind].title}</h2>
          {cards.length >= READ_PREVIEW ? (
            <Link
              href={searchHref(query, kind)}
              className="shrink-0 text-sm text-accent-text hover:underline"
            >
              Все результаты →
            </Link>
          ) : null}
        </div>
        <div className={CARD_GRID}>{cards}</div>
      </section>
    );
  } catch (err) {
    console.error(`[search] ReadPreview ${kind} query=${query} упал:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function ReadAllResults({ query }: { query: string }) {
  // Три раздела параллельно; каждый сам по себе не бросает (см. ReadPreview).
  const sections = await Promise.all(READ_KINDS.map((kind) => ReadPreview({ kind, query })));
  if (sections.every((section) => section === null)) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        <p>По запросу «{query}» ничего не найдено ни в книгах, ни в манге, ни в ранобэ.</p>
        <p>Попробуйте другое написание или оригинальное название.</p>
      </div>
    );
  }
  return <div className="flex flex-col gap-8">{sections}</div>;
}

async function ReadKindResults({
  kind,
  query,
  page,
}: {
  kind: ReadKind;
  query: string;
  page: number;
}) {
  try {
    const cards = await readSearch(kind, query, page, READ_PAGE_SIZE);
    if (cards.length === 0) {
      return (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
          <p>
            {page > 1
              ? 'Дальше результатов нет.'
              : `В разделе «${READ_META[kind].title}» по запросу «${query}» ничего не найдено.`}
          </p>
          <SourceLink kind={kind} query={query} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <div className={CARD_GRID}>{cards}</div>
        <Pagination
          page={page}
          prevHref={page > 1 ? searchHref(query, kind, page - 1) : null}
          // Точный счёт строк по поиску дорог (книг 620 тыс.), поэтому
          // «дальше» — по полной странице: неполная значит последняя.
          nextHref={cards.length >= READ_PAGE_SIZE ? searchHref(query, kind, page + 1) : null}
        />
        <SourceLink kind={kind} query={query} />
      </div>
    );
  } catch (err) {
    console.error(`[search] ReadKindResults ${kind} query=${query} упал:`, err instanceof Error ? err.message : err);
    return <SearchError />;
  }
}

function TabRow({
  label,
  tabs,
  active,
  query,
}: {
  label: string;
  tabs: { value: SearchType; label: string }[];
  active: SearchType;
  query: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-[4.5rem] shrink-0 text-sm text-gray-400">{label}</span>
      {/* Ряд прокручивается вбок, если не влез (телефон): переносить вкладки
          на вторую строку внутри «пилюли» выглядело бы сломанным. */}
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
        <nav aria-label={label} className="inline-flex rounded-full border border-white/10 bg-bg-card p-1">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={searchHref(query, tab.value)}
              aria-current={active === tab.value ? 'page' : undefined}
              className={[
                'press whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition',
                active === tab.value
                  ? 'bg-accent text-accent-fg'
                  : 'text-gray-300 hover:bg-bg-soft hover:text-accent-fg',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  // 'all' — общий поиск по аниме и кино: сюда уводит строка поиска, когда
  // включена настройка «Общий поиск» (профиль → Плеер и навигация, миграция
  // 0045). 'read' — то же для чтения: книги, манга и ранобэ разом; туда
  // уводит строка поиска в разделах чтения при той же настройке.
  const type: SearchType = isSearchType(searchParams.type) ? searchParams.type : 'anime';
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <TabRow label="Смотреть" tabs={WATCH_TABS} active={type} query={query} />
        <TabRow label="Читать" tabs={READ_TABS} active={type} query={query} />
      </div>

      <h1 className="text-xl font-bold">
        {query ? (
          <>
            Результаты по запросу{' '}
            <span className="text-accent-text">«{query}»</span>
          </>
        ) : (
          `Поиск ${SEARCH_NOUNS[type]}`
        )}
      </h1>

      {query ? (
        <Suspense key={`${type}:${query}:${page}`} fallback={<CardGridSkeleton count={12} />}>
          {type === 'read' ? (
            <ReadAllResults query={query} />
          ) : isReadKind(type) ? (
            <ReadKindResults kind={type} query={query} page={page} />
          ) : type === 'all' ? (
            // Две секции с подзаголовками, а не один перемешанный список:
            // карточки аниме и кино выглядят одинаково, и без подписи было бы
            // непонятно, почему один и тот же тайтл встречается дважды (у
            // части аниме есть и киношная запись).
            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Аниме</h2>
                <AnimeResults query={query} />
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Фильмы и сериалы</h2>
                <CinemaResults query={query} />
              </section>
            </div>
          ) : type === 'cinema' ? (
            <CinemaResults query={query} />
          ) : (
            <AnimeResults query={query} />
          )}
        </Suspense>
      ) : (
        <p className="text-sm text-gray-400">
          Введите название в строке поиска сверху.
        </p>
      )}
    </div>
  );
}
