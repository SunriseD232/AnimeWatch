import { NextResponse, type NextRequest } from 'next/server';
import { searchAnime, imageUrl } from '@/lib/shikimori';
import { searchCinema } from '@/lib/videoseed-catalog';
import { getCachedUser } from '@/lib/supabase/server';
import { searchAnimeFromIndex } from '@/lib/animeIndexQuery';
import { searchCinemaFromIndex } from '@/lib/cinemaIndexQuery';

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
 *
 * Требует сессии. Middleware сюда не достаёт — он пропускает всё под /api/
 * без проверки (см. isApiRoute в lib/supabase/middleware.ts), — поэтому
 * убрать поле поиска из шапки было бы полумерой: эндпоинт остался бы открыт
 * и продолжал бы жечь квоту Shikimori и Videoseed на любой запрос извне.
 */
export async function GET(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  const type = request.nextUrl.searchParams.get('type') === 'cinema'
    ? 'cinema'
    : 'anime';

  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  try {
    // Сперва локальный индекс: один запрос к своей базе вместо похода в
    // Shikimori/Videoseed на каждое нажатие клавиши. null — индекса нет или
    // он недоступен, тогда работаем по-старому.
    if (type === 'cinema') {
      const indexed = await searchCinemaFromIndex(q, 6);
      if (indexed) {
        return NextResponse.json({
          items: indexed.map((item) => ({
            id: item.id,
            title: item.title,
            poster: item.poster,
            contentType: 'cinema' as const,
            year: item.year,
          })),
        });
      }
    } else {
      const indexed = await searchAnimeFromIndex(q, 6);
      if (indexed) {
        return NextResponse.json({
          items: indexed.map((anime) => ({
            id: anime.id,
            title: anime.russian || anime.name,
            // Обложка с нашего диска, если она там есть (см. миграцию 0029),
            // иначе превью Shikimori — как и раньше.
            poster: anime.localPoster ?? imageUrl(anime.image?.preview),
            contentType: 'anime' as const,
            year: anime.aired_on ? Number(anime.aired_on.slice(0, 4)) : null,
          })),
        });
      }
    }

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
