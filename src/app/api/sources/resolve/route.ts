import { NextResponse, type NextRequest } from 'next/server';
import { getCachedUser } from '@/lib/supabase/server';
import {
  getCanonicalChapters,
  resolveChapterContent,
} from '@/lib/sources/resolve';
import type {
  ReadingContentType,
  SourceId,
  SourceMatch,
  SourceTitleKey,
} from '@/lib/sources/types';

/**
 * POST /api/sources/resolve
 *
 * Ленивый маппинг и каноническое оглавление. Вызывается клиентом карточки,
 * а НЕ во время server render: GET с записью в БД даёт гонки и упирается в
 * RLS.
 *
 * Body:
 *   { content_type, title_key, title, alt_titles?, year?, refresh? }
 *   опционально: { idx, source } — сразу вернуть контент главы.
 *
 * Требует авторизации: сайт закрыт приглашениями, а резолвер делает внешние
 * запросы и пишет маппинги.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPES = new Set<ReadingContentType>(['manga', 'ranobe', 'book']);

interface ResolveBody {
  content_type?: unknown;
  title_key?: unknown;
  title?: unknown;
  alt_titles?: unknown;
  year?: unknown;
  refresh?: unknown;
  idx?: unknown;
  source?: unknown;
  /** Точный слаг/внешний id у источника-каталога (Remanga dir). */
  external_id?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return badRequest('bad json');
  }

  const contentType = body.content_type;
  if (typeof contentType !== 'string' || !CONTENT_TYPES.has(contentType as ReadingContentType)) {
    return badRequest('bad content_type');
  }

  const titleKey = Number(body.title_key);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!Number.isSafeInteger(titleKey) || titleKey <= 0 || !title) {
    return badRequest('bad title');
  }

  const altTitles = Array.isArray(body.alt_titles)
    ? body.alt_titles.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
    : undefined;

  const yearNumber = Number(body.year);
  const key: SourceTitleKey = {
    contentType: contentType as ReadingContentType,
    titleKey,
    title,
    altTitles,
    year: Number.isFinite(yearNumber) ? yearNumber : undefined,
  };

  // Карточка манги знает точный Remanga `dir`. Передаём его seed'ом, чтобы
  // не искать Remanga заново по названию и не смаппить другой тайтл.
  const externalId =
    typeof body.external_id === 'string' ? body.external_id.trim() : '';
  const seed: SourceMatch | undefined =
    externalId.length > 0 && contentType === 'manga'
      ? {
          source: 'remanga',
          externalId,
          variant: 'default',
          title,
          confidence: 1,
          language: 'ru',
          externalUrl: `https://remanga.org/manga/${externalId}`,
        }
      : externalId.length > 0 && contentType === 'ranobe'
        ? {
            source: 'renovels',
            externalId,
            variant: 'default',
            title,
            confidence: 1,
            language: 'ru',
            externalUrl: `https://renovels.org/manga/${externalId}`,
          }
        : undefined;

  try {
    const chapters = await getCanonicalChapters(key, {
      refresh: body.refresh === true,
      seed,
    });

    if (body.idx != null) {
      const idx = Number(body.idx);
      if (!Number.isSafeInteger(idx) || idx <= 0) {
        return badRequest('bad idx');
      }

      const preferred =
        typeof body.source === 'string' ? (body.source as SourceId) : undefined;

      const result = await resolveChapterContent(key, idx, preferred);
      return NextResponse.json({ ok: true, chapters, result });
    }

    return NextResponse.json({ ok: true, chapters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sources/resolve] упал:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
