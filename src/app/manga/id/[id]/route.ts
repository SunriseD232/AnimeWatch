import { NextResponse, type NextRequest } from 'next/server';
import { absoluteUrl } from '@/lib/site-url';
import { getMangaById } from '@/lib/manga';
import { mangaTitleHref } from '@/lib/mangaShared';

/**
 * /manga/id/[id] → /manga/[dir].
 *
 * Карточка манги адресуется слагом Remanga, а в истории, прогрессе и
 * уведомлениях лежит только числовой id (watch_progress.shikimori_id).
 * Профиль и админка ссылаются сюда, а слаг берётся из manga_index.
 * Нет записи — в раздел манги, а не 404: тайтл мог выпасть из индекса.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const manga = await getMangaById(Number(params.id));
  const target = manga?.dir ? mangaTitleHref(manga.dir) : '/manga';
  // absoluteUrl, а не new URL(…, request.url): за nginx request.url —
  // это 127.0.0.1:3000, и редирект увёл бы браузер туда.
  return NextResponse.redirect(absoluteUrl(target, request.url));
}
