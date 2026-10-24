import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchBookFile, isFlibustaUp } from '@/lib/books';
import { bookCacheHasRoom, bookCacheStats } from '@/lib/bookCache';

/**
 * GET /api/cron/prefetch-books — запас популярных книг на нашем диске
 * (24.10.2026, lib/bookCache.ts): пока Флибуста отвечает, понемногу качаем
 * самые читаемые книги каталога, которых у нас ещё нет. В следующий сбой
 * Флибусты они откроются из кэша.
 *
 * Порядок — витрина (rank), потом скачивания на Флибусте (downloads из
 * дампа). Формат — EPUB (основной читатель), нет его — FB2. Медленно, с
 * паузой: чужой сайт, ночь, спешить некуда. Флибуста не отвечает — прогон
 * пропускается; кэш почти полон — останавливается, чтобы не вытеснять
 * запасом книги, которые люди открывали сами.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

/** Книг за ночь — потолок; реально меньше, если кончится время или место. */
const MAX_BOOKS = 400;
const PAUSE_MS = 2_000;
const TIME_BUDGET_MS = 25 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  if (!(await isFlibustaUp())) {
    console.log('[prefetch-books] Флибуста не отвечает — прогон пропущен');
    return NextResponse.json({ ok: true, skipped: 'flibusta-down' });
  }

  const { data, error } = await createServiceClient()
    .from('book_index')
    .select('book_id')
    .eq('in_catalog', true)
    .eq('local_formats', '{}')
    .order('rank', { ascending: true, nullsFirst: false })
    .order('downloads', { ascending: false, nullsFirst: false })
    .limit(MAX_BOOKS);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let saved = 0;
  let failed = 0;
  let stoppedBy: string | null = null;
  for (const row of (data ?? []) as { book_id: number }[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      stoppedBy = 'time';
      break;
    }
    if (!(await bookCacheHasRoom())) {
      stoppedBy = 'cache-full';
      break;
    }
    const id = Number(row.book_id);
    // Только Флибуста (skipFallback): запас — с основного источника, КулЛиб
    // остаётся на случай сбоя и на него ночной трафик не тратим.
    const epub = await fetchBookFile(id, 'epub', { skipFallback: true }).catch(() => null);
    const ok = epub ?? (await fetchBookFile(id, 'fb2', { skipFallback: true }).catch(() => null));
    if (ok) saved++;
    else failed++;
    // Пять провалов подряд без единой удачи — Флибуста легла посреди прогона.
    if (saved === 0 && failed >= 5) {
      stoppedBy = 'flibusta-down';
      break;
    }
    await sleep(PAUSE_MS);
  }

  const stats = await bookCacheStats();
  console.log(
    `[prefetch-books] скачано ${saved}, не вышло ${failed}, в кэше ${stats.files} файлов ` +
      `(${Math.round(stats.bytes / 1024 / 1024)} МБ)${stoppedBy ? `, остановка: ${stoppedBy}` : ''}`,
  );
  return NextResponse.json({
    ok: true,
    saved,
    failed,
    stoppedBy,
    cacheFiles: stats.files,
    cacheBytes: stats.bytes,
    durationMs: Date.now() - startedAt,
  });
}
