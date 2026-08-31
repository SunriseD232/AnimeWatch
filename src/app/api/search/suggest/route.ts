import { NextResponse, type NextRequest } from 'next/server';
import { searchAnime, imageUrl } from '@/lib/shikimori';
import { searchCinema } from '@/lib/videoseed-catalog';

export interface SearchSuggestion {
  id: number;
  title: string;
  poster: string | null;
  contentType: 'anime' | 'cinema';
  year: number | null;
}

/**
 * Подсказки при вводе — короткий список (не полноценные результаты поиска,
 * которые остаются на /search). Debounce и рендер дропдауна — на клиенте
 * (SearchBox.tsx).
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  const type = request.nextUrl.searchParams.get('type') === 'cinema'
    ? 'cinema'
    : 'anime';

  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items: SearchSuggestion[] =
      type === 'cinema'
        ? (await searchCinema(q, 6)).map((item) => ({
            id: item.id,
            title: item.title,
            poster: item.poster,
            contentType: 'cinema' as const,
            year: item.year,
          }))
        : (await searchAnime(q, 6)).map((anime) => ({
            id: anime.id,
            title: anime.russian || anime.name,
            poster: imageUrl(anime.image?.preview),
            contentType: 'anime' as const,
            year: null,
          }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error(
      `[search/suggest] q=${q} type=${type} упал:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ items: [] });
  }
}
