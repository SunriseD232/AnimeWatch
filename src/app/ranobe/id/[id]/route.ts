import { NextResponse, type NextRequest } from 'next/server';
import { absoluteUrl } from '@/lib/site-url';
import { getRanobeById } from '@/lib/ranobe';
import { ranobeTitleHref } from '@/lib/ranobeShared';

/**
 * /ranobe/id/[id] → /ranobe/[dir].
 *
 * Карточка ранобэ адресуется слагом Renovels, а в истории, прогрессе и
 * уведомлениях лежит только числовой id (watch_progress.shikimori_id).
 * Профиль и админка ссылаются сюда, а слаг берётся из ranobe_index.
 * Нет записи — в раздел ранобэ, а не 404: тайтл мог выпасть из индекса.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const ranobe = await getRanobeById(Number(params.id));
  const target = ranobe?.dir ? ranobeTitleHref(ranobe.dir) : '/ranobe';
  // absoluteUrl, а не new URL(…, request.url): за nginx request.url —
  // это 127.0.0.1:3000, и редирект увёл бы браузер туда.
  return NextResponse.redirect(absoluteUrl(target, request.url));
}
