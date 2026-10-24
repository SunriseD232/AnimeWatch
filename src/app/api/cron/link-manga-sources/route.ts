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
 *
 * Порядок (с 24.10.2026, миграция 0065) — next_manga_link_batch: сначала
 * тайтлы, которые читают и держат в списках, потом по популярности; уже
 * искавшийся тайтл — не раньше чем через 30 дней. Раньше шли курсором по id:
 * сначала старое и малоизвестное, круг — около месяца.
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

/** Попытка поиска тайтла — в source_link_attempts (миграция 0065): по ней
 *  next_*_link_batch не возвращает тайтл 30 дней. */
async function recordAttempt(
  supabase: ReturnType<typeof createServiceClient>,
  job: 'manga' | 'ranobe',
  titleKey: number,
  found: boolean,
): Promise<void> {
  await supabase
    .from('source_link_attempts')
    .upsert({ job, title_key: titleKey, found, attempted_at: new Date().toISOString() }, { onConflict: 'job,title_key' });
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

    const { data, error } = await supabase.rpc('next_manga_link_batch', { lim: BATCH_SIZE });

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
        // Находка — дополнительный источник: Remanga и MangaLib тайтл знает
        // и без этой задачи (свой индекс и еженедельная склейка).
        const found = matches.some((m) => m.source !== 'remanga' && m.source !== 'mangalib');
        if (found) matched += 1;
        else unmatched += 1;
        await recordAttempt(supabase, 'manga', key.titleKey, found);
      } catch {
        // Сетевой сбой — попытку не записываем: тайтл вернётся в следующую порцию.
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
