import Link from 'next/link';
import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { searchCinema } from '@/lib/videoseed-catalog';
import { searchAnime } from '@/lib/shikimori';
import { searchAnimeFromIndex } from '@/lib/animeIndexQuery';
import { searchCinemaFromIndex } from '@/lib/cinemaIndexQuery';
import { getSiteRatings } from '@/lib/social/server';

export const metadata = { title: 'Поиск — MediaWatch' };

type SearchType = 'anime' | 'cinema' | 'all';

const SEARCH_TABS: { value: SearchType; label: string }[] = [
  { value: 'anime', label: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы' },
  { value: 'all', label: 'Везде' },
];

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {animes.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>
    );
  } catch (err) {
    console.error(`[search] AnimeResults query=${query} упал:`, err instanceof Error ? err.message : err);
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Ошибка поиска. Попробуйте ещё раз.
      </p>
    );
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <CinemaCard key={item.id} item={item} siteRating={siteRatings.get(item.id) ?? null} />
        ))}
      </div>
    );
  } catch (err) {
    console.error(`[search] CinemaResults query=${query} упал:`, err instanceof Error ? err.message : err);
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Ошибка поиска. Попробуйте ещё раз.
      </p>
    );
  }
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  // 'all' — общий поиск: сюда уводит строка поиска, когда включена настройка
  // «Общий поиск» (профиль → Плеер и навигация, миграция 0045). Показываем
  // оба раздела сразу, аниме первым.
  const type: SearchType =
    searchParams.type === 'cinema' ? 'cinema' : searchParams.type === 'all' ? 'all' : 'anime';
  const isCinema = type === 'cinema';
  const noun = type === 'all' ? 'по всему сайту' : isCinema ? 'фильмов и сериалов' : 'аниме';
  // Все остальные страницы сайта показывают переключатель Аниме/Кино
  // (ModeSwitch) — на поиске его не было вообще, переключить тип запроса
  // можно было только вручную правкой ?type= в адресной строке.
  const typeHref = (next: SearchType) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    // Аниме — состояние по умолчанию, его в адресе не пишем: так ссылки
    // остаются такими же, какими были до появления общего поиска.
    if (next !== 'anime') params.set('type', next);
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-full border border-white/10 bg-bg-card p-1">
        {SEARCH_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={typeHref(tab.value)}
            aria-current={type === tab.value ? 'page' : undefined}
            className={[
              'press whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition',
              type === tab.value
                ? 'bg-accent text-accent-fg'
                : 'text-gray-300 hover:bg-bg-soft hover:text-accent-fg',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <h1 className="text-xl font-bold">
        {query ? (
          <>
            Результаты по запросу{' '}
            <span className="text-accent-text">«{query}»</span>
          </>
        ) : (
          `Поиск ${noun}`
        )}
      </h1>

      {query ? (
        <Suspense key={`${type}:${query}`} fallback={<CardGridSkeleton count={12} />}>
          {type === 'all' ? (
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
          ) : isCinema ? (
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
