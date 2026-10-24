import { getCachedJson } from '@/lib/cache/apiCache';
import { wordSearchFilter } from '@/lib/indexSearch';
import { audiobookFromRow } from '@/lib/readingCatalog';
import { createClient } from '@/lib/supabase/server';
import {
  fetchKnigavuheBook,
  knigavuheFallbackUrl,
  type KnigavuheBook,
} from '@/lib/sources/knigavuhe';
import type { AudiobookDetails, AudiobookSummary } from '@/lib/audiobookShared';

/**
 * Аудиокниги: чтение из своего индекса (audiobook_index, миграция 0064) и
 * главы со страницы книги knigavuhe. Никогда не бросает: нет индекса или
 * источник не ответил — пусто / null, и страница честно об этом скажет.
 */

/** Главы кэшируются на час: список файлов книги меняется редко, а без кэша
 *  каждое открытие плеера ходило бы на knigavuhe за страницей целиком. */
const CHAPTERS_TTL_SECONDS = 60 * 60;

export async function getAudiobookById(id: number): Promise<AudiobookSummary | null> {
  try {
    const { data } = await createClient().from('audiobook_index').select('*').eq('id', id).maybeSingle();
    return data ? audiobookFromRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Карточка + главы. null — книги нет в индексе. Главы пустые — источник
 *  не ответил (карточка покажется, плеер скажет, что звук недоступен). */
export async function getAudiobookDetails(id: number): Promise<AudiobookDetails | null> {
  const summary = await getAudiobookById(id);
  if (!summary) return null;

  let book: KnigavuheBook | null = null;
  try {
    book = await getCachedJson<KnigavuheBook>(
      `audiobook:chapters:${id}`,
      CHAPTERS_TTL_SECONDS,
      async () => {
        const fresh = await fetchKnigavuheBook(summary.slug);
        // Бросаем, а не возвращаем null: сбой источника не должен лечь в
        // кэш на час — следующий заход попробует снова.
        if (!fresh) throw new Error('knigavuhe: глав нет или страница не пришла');
        return fresh;
      },
    );
  } catch {
    book = null;
  }

  return {
    ...summary,
    // Подпись запасной ссылки — свежая на каждый запрос: у неё свой срок
    // жизни, и из кэша она могла бы прийти уже просроченной.
    chapters: (book?.chapters ?? []).map((chapter) => ({
      ...chapter,
      fallbackUrl: knigavuheFallbackUrl(chapter.url),
    })),
    description: book?.description ?? summary.annotation,
  };
}

/** Озвучки книги Флибусты — для блока «Слушать» на её карточке. Самые
 *  популярные первыми. */
export async function getAudiobooksForBook(bookId: number): Promise<AudiobookSummary[]> {
  try {
    const { data } = await createClient()
      .from('audiobook_index')
      .select('*')
      .eq('book_id', bookId)
      .eq('in_catalog', true)
      .order('views', { ascending: false, nullsFirst: false })
      .limit(12);
    return ((data ?? []) as Record<string, unknown>[]).map(audiobookFromRow);
  } catch {
    return [];
  }
}

/** Витрина и поиск раздела: по словам в названии и авторах (как у книг). */
export async function getAudiobookList(params: {
  query?: string;
  sort: 'popular' | 'new';
  page: number;
  pageSize: number;
}): Promise<{ items: AudiobookSummary[]; hasMore: boolean }> {
  const from = (Math.max(1, params.page) - 1) * params.pageSize;
  try {
    let q = createClient().from('audiobook_index').select('*').eq('in_catalog', true);
    const query = (params.query ?? '').trim();
    if (query) {
      const filter = wordSearchFilter(query, ['title', 'authors_text']);
      if (filter) q = q.or(filter);
    }
    q =
      params.sort === 'new'
        ? q.order('id', { ascending: false })
        : q.order('views', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
    const { data } = await q.range(from, from + params.pageSize);
    const rows = (data ?? []) as Record<string, unknown>[];
    return {
      items: rows.slice(0, params.pageSize).map(audiobookFromRow),
      hasMore: rows.length > params.pageSize,
    };
  } catch {
    return { items: [], hasMore: false };
  }
}
