import { NextResponse, type NextRequest } from 'next/server';
import { getBookById } from '@/lib/books';
import { removeSavedBook, saveBookForUser } from '@/lib/bookStorage';
import { getCachedUser } from '@/lib/supabase/server';

/**
 * POST   /api/books/[id]/save — сохранить книгу на сервере (до 10 на человека).
 * DELETE /api/books/[id]/save — убрать из сохранённых.
 *
 * Логика и сроки хранения — lib/bookStorage.ts, миграция 0058.
 *
 * Метаданные берём из нашего book_index, а не из тела запроса: иначе в
 * список можно было бы записать любое название и обложку.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Два файла с Флибусты параллельно, у каждого не больше ~60 сек (повторы по
// зеркалам, см. fetchFromMirrors) — укладывается в 90 сек nginx.
export const maxDuration = 90;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = parseId(params.id);
  if (id == null) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const book = await getBookById(id);
  if (!book) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await saveBookForUser(user.id, {
    bookId: book.id,
    title: book.title,
    author: book.author || null,
    coverUrl: book.coverUrl,
    formats: book.formats,
  });

  if (result.ok) return NextResponse.json(result);

  const status =
    result.reason === 'limit'
      ? 409
      : result.reason === 'quota'
        ? 507
        : result.reason === 'too_large'
          ? 413
          : result.reason === 'source'
            ? 502
            : 500;
  return NextResponse.json(result, { status });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = parseId(params.id);
  if (id == null) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  try {
    await removeSavedBook(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[books/save] удаление упало:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'remove failed' }, { status: 500 });
  }
}
