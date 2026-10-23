import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ensureTitleSources } from '@/lib/sources/resolve';
import type { SourceTitleKey } from '@/lib/sources/types';

/**
 * GET /api/cron/link-manga-sources — chunked-маппинг манги на источники.
 *
 * Один вызов обрабатывает batch тайтлов и возвращается: 60-минутная функция
 * на serverless невозможна. VPS-крон дёргает endpoint каждые 5 минут, пока
 * `done=false`.
 *
 * Пишет только title_sources (корни тайтлов). Канонические главы строятся
 * лениво — при первом открытии карточки/читателя (см. lib/sources/resolve.ts).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Сколько тайтлов за один вызов. */
const BATCH_SIZE = 20;

interface MangaRow {
  title_id: number;
  title: string;
  original_title: string | null;
  alternative_title: string | null;
  year: number | null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date().toISOString();

  // Отмечаем старт сразу: админка проверяет «уже идёт?» по этой паре.
  await supabase
    .from('source_link_state')
    .update({ last_run_started_at: startedAt })
    .eq('job', 'manga');

  try {
    const { data: state } = await supabase
      .from('source_link_state')
      .select('last_cursor, titles_done')
      .eq('job', 'manga')
      .maybeSingle();

    const cursor =
      state && typeof state.last_cursor === 'number' ? state.last_cursor : 0;
    const titlesDone =
      state && typeof state.titles_done === 'number' ? state.titles_done : 0;

    const { data, error } = await supabase
      .from('manga_index')
      .select('title_id, title, original_title, alternative_title, year')
      .order('title_id', { ascending: true })
      .gt('title_id', cursor)
      .limit(BATCH_SIZE);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as MangaRow[];
    let matched = 0;
    let unmatched = 0;

    for (const row of rows) {
      const key: SourceTitleKey = {
        contentType: 'manga',
        titleKey: Number(row.title_id),
        title: row.title,
        altTitles: [row.original_title, row.alternative_title].filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
        year: row.year ?? undefined,
      };

      try {
        const matches = await ensureTitleSources(key);
        if (matches.length > 0) matched += 1;
        else unmatched += 1;
      } catch {
        unmatched += 1;
      }
    }

    const lastId =
      rows.length > 0 ? Number(rows[rows.length - 1].title_id) : cursor;
    const done = rows.length < BATCH_SIZE;

    await supabase
      .from('source_link_state')
      .update({
        last_cursor: done ? 0 : lastId,
        // Новый круг (курсор с нуля) — счётчик тоже с нуля, иначе после
        // done он рос бы бесконечно и в админке ничего не значил.
        titles_done: (cursor === 0 ? 0 : titlesDone) + rows.length,
        last_run_started_at: startedAt,
        last_run_finished_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('job', 'manga');

    console.log(
      `[link-manga-sources] batch=${rows.length} matched=${matched} ` +
        `unmatched=${unmatched} cursor=${done ? 0 : lastId} done=${done}`,
    );

    return NextResponse.json({
      ok: true,
      processed: rows.length,
      matched,
      unmatched,
      cursor: done ? 0 : lastId,
      done,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[link-manga-sources] упал:', message);

    try {
      await supabase
        .from('source_link_state')
        .update({
          last_run_finished_at: new Date().toISOString(),
          last_error: message,
        })
        .eq('job', 'manga');
    } catch {
      /* причина уже в логе */
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
