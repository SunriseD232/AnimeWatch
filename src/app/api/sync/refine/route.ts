import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAudiobookDetails } from '@/lib/audiobooks';
import { refineToAudio, refineToBook } from '@/lib/speechAlign';
import { DRAMA_GENRE } from '@/lib/audiobookShared';

export const dynamic = 'force-dynamic';
// Вырезка фрагмента (~3 с) + распознавание (~13 с) + ожидание очереди.
export const maxDuration = 120;

/**
 * POST /api/sync/refine — этап 2 синхронизации книги и аудиокниги
 * (lib/speechAlign.ts): уточнить оценку этапа 1 по распознанной речи.
 *
 *   { audiobookId, direction: 'toAudio', fraction }            → { chapterIndex, position }
 *   { audiobookId, direction: 'toBook', chapterIndex, position } → { fraction }
 *
 * Только для вошедших: распознавание — десяток секунд процессора VPS, и
 * открытый наружу эндпоинт стал бы способом его занять. Ответ всегда 200 со
 * статусом: refined | not_found | busy | unavailable — клиент в любом
 * случае остаётся на оценке этапа 1, ошибка тут не авария.
 */
export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы уточнять место.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const audiobookId = Number(body?.audiobookId);
  if (!Number.isSafeInteger(audiobookId) || audiobookId <= 0) {
    return NextResponse.json({ error: 'Нет аудиокниги.' }, { status: 400 });
  }

  const audiobook = await getAudiobookDetails(audiobookId);
  if (!audiobook?.bookId || audiobook.chapters.length === 0 || audiobook.genres.includes(DRAMA_GENRE)) {
    return NextResponse.json({ status: 'not_found' });
  }

  if (body?.direction === 'toAudio') {
    const fraction = Number(body.fraction);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      return NextResponse.json({ error: 'Неверная доля текста.' }, { status: 400 });
    }
    const result = await refineToAudio(audiobook.chapters, audiobook.bookId, fraction);
    return NextResponse.json(result.status === 'refined' ? { status: 'refined', ...result.value } : result);
  }

  if (body?.direction === 'toBook') {
    const chapterIndex = Number(body.chapterIndex);
    const position = Number(body.position);
    if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 1 || !Number.isFinite(position) || position < 0) {
      return NextResponse.json({ error: 'Неверное место в записи.' }, { status: 400 });
    }
    const result = await refineToBook(audiobook.chapters, audiobook.bookId, { chapterIndex, position });
    return NextResponse.json(
      result.status === 'refined' ? { status: 'refined', fraction: result.value } : result,
    );
  }

  return NextResponse.json({ error: 'direction: toAudio или toBook.' }, { status: 400 });
}
