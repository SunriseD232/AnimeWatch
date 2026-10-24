import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ensureTitleSources } from '@/lib/sources/resolve';
import { fetchOpdsPage } from '@/lib/books';
import type { SourceMatch, SourceTitleKey } from '@/lib/sources/types';

/**
 * GET /api/cron/link-ranobe-flibusta — chunked-маппинг ранобэ на тома
 * Флибусты.
 *
 * Renovels остаётся источником глав, Флибуста — источником томов (EPUB).
 * Один вызов обрабатывает batch и возвращается; VPS-крон повторяет, пока
 * `done=false`.
 *
 * Порядок (с 24.10.2026, миграция 0065) — next_ranobe_link_batch: сначала
 * читаемое и то, что в списках, потом по популярности; уже искавшийся
 * тайтл — не раньше чем через 30 дней. Перед порцией — одна проверка, что
 * Флибуста отвечает: лежит — прогон пропускаем, ничего не помечая (24.10.2026
 * 51 прогон подряд при лежащей Флибусте «не нашёл» ничего и сжёг круг).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Flibusta OPDS медленнее MangaDex — батч меньше. */
const BATCH_SIZE = 10;

interface RanobeRow {
  title_id: number;
  dir: string;
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
    .eq('job', 'ranobe');

  try {
    const { data: state } = await supabase
      .from('source_link_state')
      .select('last_cursor, titles_done')
      .eq('job', 'ranobe')
      .maybeSingle();

    const cursor =
      state && typeof state.last_cursor === 'number' ? state.last_cursor : 0;
    const titlesDone =
      state && typeof state.titles_done === 'number' ? state.titles_done : 0;

    const alive = await fetchOpdsPage('/opds/new/0/new');
    if (!alive) {
      await supabase
        .from('source_link_state')
        .update({
          last_run_finished_at: new Date().toISOString(),
          last_error: 'Флибуста не отвечает — прогон пропущен',
        })
        .eq('job', 'ranobe');
      console.log('[link-ranobe-flibusta] Флибуста не отвечает — прогон пропущен');
      return NextResponse.json({ ok: true, skipped: 'flibusta-down' });
    }

    const { data, error } = await supabase.rpc('next_ranobe_link_batch', { lim: BATCH_SIZE });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as RanobeRow[];
    let withFlibusta = 0;
    let withoutFlibusta = 0;

    for (const row of rows) {
      const key: SourceTitleKey = {
        contentType: 'ranobe',
        titleKey: Number(row.title_id),
        title: row.title,
        altTitles: [row.original_title, row.alternative_title].filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
        year: row.year ?? undefined,
      };

      // Renovels уже известен точно — seed, без повторного поиска.
      const seed: SourceMatch = {
        source: 'renovels',
        externalId: row.dir,
        variant: 'default',
        title: row.title,
        confidence: 1,
        language: 'ru',
        externalUrl: `https://renovels.org/manga/${row.dir}`,
      };

      try {
        const matches = await ensureTitleSources(key, seed);
        const found = matches.some((match) => match.source === 'flibusta');
        if (found) withFlibusta += 1;
        else withoutFlibusta += 1;
        await recordAttempt(supabase, 'ranobe', key.titleKey, found);
      } catch {
        // Сетевой сбой — попытку не записываем: тайтл вернётся в следующую порцию.
        withoutFlibusta += 1;
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
      .eq('job', 'ranobe');

    console.log(
      `[link-ranobe-flibusta] batch=${rows.length} withFlibusta=${withFlibusta} ` +
        `without=${withoutFlibusta} cursor=${done ? 0 : lastId} done=${done}`,
    );

    return NextResponse.json({
      ok: true,
      processed: rows.length,
      withFlibusta,
      withoutFlibusta,
      cursor: done ? 0 : lastId,
      done,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[link-ranobe-flibusta] упал:', message);

    try {
      await supabase
        .from('source_link_state')
        .update({
          last_run_finished_at: new Date().toISOString(),
          last_error: message,
        })
        .eq('job', 'ranobe');
    } catch {
      /* причина уже в логе */
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
