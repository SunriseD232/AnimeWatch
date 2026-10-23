/**
 * Резолвер источников.
 *
 * Единственное место, где известно про несколько источников. Компоненты
 * получают канонические главы и готовый контент, а не ветвятся по Remanga/
 * MangaDex/Флибусте.
 *
 * Server-only: использует service_role (кроны, запись маппингов).
 */

import { createServiceClient } from '@/lib/supabase/service';
import { mergeChapters, type SourceChapterGroup } from './canonical';
import { getAdapter, getAdapters } from './registry';
import type {
  CanonicalChapter,
  ChapterSourceRef,
  ResolveChapterResult,
  SourceId,
  SourceMatch,
  SourceTitleKey,
} from './types';

/** Таймаут поиска тайтла в одном источнике. */
const MATCH_TIMEOUT_MS = 8_000;
/** Таймаут загрузки оглавления. */
const CHAPTERS_TIMEOUT_MS = 30_000;
/** Размер пачки при вставке. */
const INSERT_CHUNK = 500;
/**
 * Negative-cache: «источник не нашёл тайтл» помним сутки, чтобы не дёргать
 * внешний сайт на каждом открытии карточки. Живёт в памяти процесса; после
 * деплоя сбрасывается — это нормально.
 */
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const negativeMatches = new Map<string, number>();

function negativeKey(key: SourceTitleKey, source: SourceId): string {
  return `${key.contentType}:${key.titleKey}:${source}`;
}

interface TitleSourceRow {
  content_type: string;
  title_key: number;
  source: string;
  external_id: string;
  external_url: string | null;
  variant: string;
  title: string | null;
  chapters_count: number | null;
  language: string | null;
  confidence: number;
}

interface CanonicalRow {
  idx: number;
  chapter_no: number | string | null;
  tome: number | string | null;
  label: string;
}

interface ChapterSourceRow {
  idx: number;
  source: string;
  variant: string;
  source_chapter_key: string;
  is_paid: boolean;
  is_free_today: boolean;
  pages_count: number | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function rowToMatch(row: TitleSourceRow): SourceMatch {
  return {
    source: row.source as SourceId,
    externalId: row.external_id,
    variant: row.variant,
    title: row.title ?? '',
    confidence: row.confidence,
    chaptersCount: row.chapters_count ?? undefined,
    language: row.language ?? undefined,
    externalUrl: row.external_url ?? undefined,
  };
}

/**
 * Сохранённые маппинги; если их нет — ищет по включённым адаптерам.
 *
 * `seed` — уже известный маппинг (например, Remanga `dir` с карточки).
 * Он записывается напрямую, без повторного поиска по названию: карточка
 * знает точный слаг, и поиск мог бы выбрать другой тайтл.
 */
export async function ensureTitleSources(
  key: SourceTitleKey,
  seed?: SourceMatch,
): Promise<SourceMatch[]> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('title_sources')
    .select('*')
    .eq('content_type', key.contentType)
    .eq('title_key', key.titleKey)
    .eq('is_active', true);

  const existing = (data ?? []) as TitleSourceRow[];
  const seeded: SourceMatch[] = [];

  if (seed) {
    const alreadyKnown = existing.some(
      (row) => row.source === seed.source && row.variant === seed.variant,
    );

    if (!alreadyKnown) {
      const { error } = await supabase.from('title_sources').upsert(
        {
          content_type: key.contentType,
          title_key: key.titleKey,
          source: seed.source,
          external_id: seed.externalId,
          external_url: seed.externalUrl ?? null,
          variant: seed.variant,
          title: seed.title,
          chapters_count: seed.chaptersCount ?? null,
          language: seed.language ?? null,
          confidence: seed.confidence,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'content_type,title_key,source,variant' },
      );

      if (!error) seeded.push(seed);
    }
  }

  const known = new Set([
    ...existing.map((row) => row.source),
    ...seeded.map((match) => match.source),
  ]);

  // Досматриваем только те источники, которых ещё нет в маппинге. Так новый
  // источник (например, включённый позже MangaDex) подхватывается без
  // пересборки всей таблицы.
  const now = Date.now();
  const missing = getAdapters(key.contentType).filter((adapter) => {
    if (!adapter.isEnabled() || known.has(adapter.id)) return false;
    const until = negativeMatches.get(negativeKey(key, adapter.id));
    return until == null || until <= now;
  });

  if (missing.length === 0) {
    return [...existing.map(rowToMatch), ...seeded];
  }

  const settled = await Promise.allSettled(
    missing.map((adapter) =>
      withTimeout(adapter.findByTitle(key), MATCH_TIMEOUT_MS),
    ),
  );

  const matches: SourceMatch[] = [];
  settled.forEach((result, index) => {
    const adapter = missing[index];
    if (result.status === 'fulfilled' && result.value) {
      matches.push(result.value);
      negativeMatches.delete(negativeKey(key, adapter.id));
    } else {
      // null, timeout или ошибка — не бьём источник на каждом рендере.
      negativeMatches.set(
        negativeKey(key, adapter.id),
        now + NEGATIVE_TTL_MS,
      );
    }
  });

  if (matches.length > 0) {
    const rows = matches.map((match) => ({
      content_type: key.contentType,
      title_key: key.titleKey,
      source: match.source,
      external_id: match.externalId,
      external_url: match.externalUrl ?? null,
      variant: match.variant,
      title: match.title,
      chapters_count: match.chaptersCount ?? null,
      language: match.language ?? null,
      confidence: match.confidence,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    await supabase.from('title_sources').upsert(rows, {
      onConflict: 'content_type,title_key,source,variant',
    });
  }

  return [...existing.map(rowToMatch), ...seeded, ...matches];
}

/**
 * PostgREST отдаёт не больше max_rows (в Supabase по умолчанию 1000) строк
 * за запрос и молча обрезает остальное. У длинных тайтлов глав больше
 * (martial_peak — 3865), а строк chapter_sources ещё в разы больше —
 * по одной на источник. Без постраничного чтения карточка показала бы
 * первую тысячу глав, а у остальных не нашлось бы ни одного источника.
 */
const READ_PAGE = 1000;

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await fetchPage(from, from + READ_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}

async function readCanonical(
  key: SourceTitleKey,
): Promise<CanonicalChapter[]> {
  const supabase = createServiceClient();

  const [chapters, sourceRows] = await Promise.all([
    readAllPages<CanonicalRow>((from, to) =>
      supabase
        .from('canonical_chapters')
        .select('idx, chapter_no, tome, label')
        .eq('content_type', key.contentType)
        .eq('title_key', key.titleKey)
        .order('idx', { ascending: true })
        .range(from, to),
    ),
    // Порядок нужен для стабильных страниц: без order() Postgres вправе
    // вернуть строки на стыке страниц дважды или пропустить.
    readAllPages<ChapterSourceRow>((from, to) =>
      supabase
        .from('chapter_sources')
        .select(
          'idx, source, variant, source_chapter_key, is_paid, is_free_today, pages_count',
        )
        .eq('content_type', key.contentType)
        .eq('title_key', key.titleKey)
        .order('idx', { ascending: true })
        .order('source', { ascending: true })
        .order('variant', { ascending: true })
        .range(from, to),
    ),
  ]);

  if (chapters.length === 0) return [];

  const byIdx = new Map<number, ChapterSourceRef[]>();
  for (const row of sourceRows) {
    const list = byIdx.get(row.idx) ?? [];
    list.push({
      source: row.source as SourceId,
      variant: row.variant,
      chapterKey: row.source_chapter_key,
      isPaid: row.is_paid,
      isFreeToday: row.is_free_today,
      pagesCount: row.pages_count ?? undefined,
    });
    byIdx.set(row.idx, list);
  }

  return chapters.map((row) => ({
    idx: row.idx,
    chapterNo: row.chapter_no == null ? null : Number(row.chapter_no),
    tome: row.tome == null ? null : Number(row.tome),
    label: row.label,
    sources: byIdx.get(row.idx) ?? [],
  }));
}

async function persistCanonical(
  key: SourceTitleKey,
  chapters: CanonicalChapter[],
): Promise<void> {
  const supabase = createServiceClient();

  await supabase
    .from('chapter_sources')
    .delete()
    .eq('content_type', key.contentType)
    .eq('title_key', key.titleKey);

  await supabase
    .from('canonical_chapters')
    .delete()
    .eq('content_type', key.contentType)
    .eq('title_key', key.titleKey);

  if (chapters.length === 0) return;

  const canonicalRows = chapters.map((chapter) => ({
    content_type: key.contentType,
    title_key: key.titleKey,
    idx: chapter.idx,
    chapter_no: chapter.chapterNo,
    tome: chapter.tome ?? null,
    label: chapter.label,
  }));

  const sourceRows = chapters.flatMap((chapter) =>
    chapter.sources.map((source) => ({
      content_type: key.contentType,
      title_key: key.titleKey,
      idx: chapter.idx,
      source: source.source,
      variant: source.variant,
      source_chapter_key: source.chapterKey,
      is_paid: source.isPaid,
      is_free_today: source.isFreeToday,
      pages_count: source.pagesCount ?? null,
    })),
  );

  // Ошибки вставки не глотаем молча: при гонке двух persist (delete+insert
  // без транзакции, см. P2 в SESSION-REPORT) оглавление может остаться
  // неполным, и без строки в логе это не отличить от «источник отдал мало».
  for (const batch of chunk(canonicalRows, INSERT_CHUNK)) {
    const { error } = await supabase.from('canonical_chapters').insert(batch);
    if (error) {
      console.error(
        `[sources] canonical_chapters ${key.contentType}:${key.titleKey} не записались:`,
        error.message,
      );
    }
  }

  for (const batch of chunk(sourceRows, INSERT_CHUNK)) {
    const { error } = await supabase.from('chapter_sources').insert(batch);
    if (error) {
      console.error(
        `[sources] chapter_sources ${key.contentType}:${key.titleKey} не записались:`,
        error.message,
      );
    }
  }
}

/**
 * Каноническое оглавление тайтла.
 * Строится из всех включённых адаптеров, кроме томов (Флибуста).
 */
export async function getCanonicalChapters(
  key: SourceTitleKey,
  options: { refresh?: boolean; seed?: SourceMatch } = {},
): Promise<CanonicalChapter[]> {
  const existing = await readCanonical(key);
  if (!options.refresh && existing.length > 0) return existing;

  const matches = await ensureTitleSources(key, options.seed);
  const groups: SourceChapterGroup[] = [];
  let failed = 0;

  for (const match of matches) {
    const adapter = getAdapter(match.source);
    if (!adapter || !adapter.isEnabled()) continue;
    if (adapter.granularity === 'volume') continue;

    try {
      const chapters = await withTimeout(
        adapter.listChapters(match),
        CHAPTERS_TIMEOUT_MS,
      );
      if (chapters.length > 0) {
        groups.push({
          source: match.source,
          variant: match.variant,
          chapters,
        });
      }
    } catch {
      // Один упавший источник не должен ломать оглавление.
      failed += 1;
    }
  }

  const merged = mergeChapters(groups);

  // Ничего не собрали — оставляем то, что уже было.
  if (merged.length === 0) return existing;

  // Часть источников упала, и новая выборка короче старой — не затираем
  // текущее оглавление. Иначе временный сбой MangaDex удалил бы его главы
  // из прогресса и «Продолжить».
  if (failed > 0 && existing.length > 0 && merged.length < existing.length) {
    return existing;
  }

  await persistCanonical(key, merged);
  return merged;
}

async function loadMatch(
  key: SourceTitleKey,
  source: SourceId,
  variant: string,
): Promise<SourceMatch | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('title_sources')
    .select('*')
    .eq('content_type', key.contentType)
    .eq('title_key', key.titleKey)
    .eq('source', source)
    .eq('variant', variant)
    .eq('is_active', true)
    .maybeSingle();

  return data ? rowToMatch(data as TitleSourceRow) : null;
}

async function readChapterSources(
  key: SourceTitleKey,
  idx: number,
): Promise<ChapterSourceRow[]> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('chapter_sources')
    .select(
      'idx, source, variant, source_chapter_key, is_paid, is_free_today, pages_count',
    )
    .eq('content_type', key.contentType)
    .eq('title_key', key.titleKey)
    .eq('idx', idx);

  return (data ?? []) as ChapterSourceRow[];
}

/**
 * Контент канонической главы.
 *
 * Порядок: preferred → приоритет реестра. Платные главы пропускаются; если
 * бесплатных нет, возвращается reason='paid' без запроса страниц.
 */
export async function resolveChapterContent(
  key: SourceTitleKey,
  idx: number,
  preferred?: SourceId,
): Promise<ResolveChapterResult> {
  let rows = await readChapterSources(key, idx);

  if (rows.length === 0) {
    await getCanonicalChapters(key, { refresh: true });
    rows = await readChapterSources(key, idx);
  }

  if (rows.length === 0) {
    return { ok: false, reason: 'not-found' };
  }

  const priority = getAdapters(key.contentType).map((adapter) => adapter.id);
  const rank = (source: SourceId): number => {
    const index = priority.indexOf(source);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const sorted = [...rows].sort((a, b) => {
    if (preferred) {
      if (a.source === preferred && b.source !== preferred) return -1;
      if (b.source === preferred && a.source !== preferred) return 1;
    }
    return rank(a.source as SourceId) - rank(b.source as SourceId);
  });

  let sawPaid = false;

  for (const row of sorted) {
    if (row.is_paid && !row.is_free_today) {
      sawPaid = true;
      continue;
    }

    const source = row.source as SourceId;
    const adapter = getAdapter(source);
    if (!adapter || !adapter.isEnabled()) continue;

    const match = await loadMatch(key, source, row.variant);
    if (!match) continue;

    try {
      const content = await adapter.getChapter(match, row.source_chapter_key);
      if (content) {
        return {
          ok: true,
          source,
          variant: row.variant,
          chapterKey: row.source_chapter_key,
          content,
        };
      }
    } catch {
      // Пробуем следующий источник.
    }
  }

  return sawPaid
    ? { ok: false, reason: 'paid' }
    : { ok: false, reason: 'unavailable' };
}

/**
 * Только чтение: сохранённое каноническое оглавление, БЕЗ маппинга и без
 * внешних запросов. Используется в server render, где писать в БД нельзя.
 * Если БД недоступна (например, нет service_role в локальной сборке) —
 * возвращает пустой список, и страница откатывается на Remanga.
 */
export async function getStoredCanonicalChapters(
  key: SourceTitleKey,
): Promise<CanonicalChapter[]> {
  try {
    return await readCanonical(key);
  } catch {
    return [];
  }
}

/** Есть ли уже сохранённые маппинги источников для тайтла. */
export async function hasStoredTitleSources(
  key: SourceTitleKey,
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from('title_sources')
      .select('id', { count: 'exact', head: true })
      .eq('content_type', key.contentType)
      .eq('title_key', key.titleKey)
      .eq('is_active', true);

    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Сохранённые маппинги: только чтение, без внешних запросов. */
export async function getStoredTitleSources(
  key: SourceTitleKey,
): Promise<SourceMatch[]> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('title_sources')
      .select('*')
      .eq('content_type', key.contentType)
      .eq('title_key', key.titleKey)
      .eq('is_active', true);

    return ((data ?? []) as TitleSourceRow[]).map(rowToMatch);
  } catch {
    return [];
  }
}

/**
 * Старый id главы у источника (например, Remanga chapterId) → канонический
 * idx. Нужен, чтобы старые ссылки /read/[dir]/[chapterId] не ломались после
 * перехода на каноническую ось.
 */
export async function findCanonicalIdxBySourceKey(
  key: SourceTitleKey,
  source: SourceId,
  chapterKey: string,
): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('chapter_sources')
      .select('idx')
      .eq('content_type', key.contentType)
      .eq('title_key', key.titleKey)
      .eq('source', source)
      .eq('source_chapter_key', chapterKey)
      .maybeSingle();

    return data && typeof data.idx === 'number' ? data.idx : null;
  } catch {
    return null;
  }
}
