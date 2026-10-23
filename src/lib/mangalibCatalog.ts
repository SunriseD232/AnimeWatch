import { createServiceClient } from '@/lib/supabase/service';
import {
  MANGALIB_DIR_PREFIX,
  MANGALIB_KEY_OFFSET,
  fetchMangaLibCatalogPage,
  mangaLibCover,
  mangaLibSiteUrl,
  type MangaLibListItem,
} from '@/lib/sources/mangalib';

/**
 * Каталог манги — объединение Remanga и MangaLib (24.10.2026: «хочу видеть в
 * каталоге всё, что доступно к чтению, а не один каталог»).
 *
 * Раз в неделю (после полного обхода Remanga) обходим весь каталог MangaLib
 * (~41,6 тыс. тайтлов, ~690 страниц) и для каждого тайтла:
 *   • нашлась пара у Remanga — это одна карточка: пишем MangaLib в
 *     title_sources как источник глав этого тайтла (читатель возьмёт
 *     бесплатную главу там, где она есть, см. lib/sources/resolve.ts);
 *   • пары нет — своя карточка в manga_index: title_id = MANGALIB_KEY_OFFSET +
 *     id MangaLib, dir = «ml-» + slug_url. Описание, жанры и главы карточка
 *     берёт у MangaLib (getMangaDetails → getMangaLibDetails).
 *
 * Пара — только однозначная: одно и то же нормализованное название (рус.,
 * англ. или оригинальное) ведёт ровно к одному тайтлу Remanga, и год, если он
 * известен у обоих, расходится не больше чем на год. Сомнительное лучше
 * показать двумя карточками, чем склеить чужие тайтлы.
 */

const MIN_SANE = 20_000;
const CHUNK = 500;
const READ_PAGE = 1000;
/** Повторы страницы каталога, если MangaLib не ответил. */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
/** Строка состояния в source_link_state. */
const STATE_JOB = 'mangalib-catalog';

export interface MangaLibSyncResult {
  titles: number;
  matched: number;
  ownCards: number;
  requests: number;
  durationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Название для сравнения: регистр, ё/е, пунктуация и пробелы не важны. */
export function normalizeTitle(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

interface RemangaNames {
  id: number;
  year: number | null;
}

/** Все названия тайтлов Remanga → id. Название у нескольких тайтлов —
 *  неоднозначно, по нему не склеиваем. */
async function loadRemangaNames(): Promise<Map<string, RemangaNames | 'ambiguous'>> {
  const supabase = createServiceClient();
  const names = new Map<string, RemangaNames | 'ambiguous'>();
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('manga_index')
      .select('title_id, title, original_title, alternative_title, year')
      .lt('title_id', MANGALIB_KEY_OFFSET)
      .order('title_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`manga_index: ${error.message}`);
    for (const row of data ?? []) {
      const id = Number(row.title_id);
      const year = row.year == null ? null : Number(row.year);
      // another_name у Remanga — несколько названий через « / ».
      const all = [row.title, row.original_title, ...String(row.alternative_title ?? '').split(/\s*\/\s*/)];
      for (const raw of all) {
        const key = normalizeTitle(raw as string | null);
        if (key.length < 3) continue;
        const known = names.get(key);
        if (known === undefined) names.set(key, { id, year });
        else if (known !== 'ambiguous' && known.id !== id) names.set(key, 'ambiguous');
      }
    }
    if ((data ?? []).length < READ_PAGE) break;
  }
  return names;
}

/** Однозначная пара у Remanga или null. */
function matchRemanga(
  item: MangaLibListItem,
  names: Map<string, RemangaNames | 'ambiguous'>,
): number | null {
  const ids = new Set<number>();
  for (const raw of [item.rusName, item.engName, item.name]) {
    const key = normalizeTitle(raw);
    if (key.length < 3) continue;
    const hit = names.get(key);
    if (!hit || hit === 'ambiguous') continue;
    if (item.year != null && hit.year != null && Math.abs(item.year - hit.year) > 1) continue;
    ids.add(hit.id);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

async function upsert(table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await createServiceClient()
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

async function setState(patch: Record<string, unknown>): Promise<void> {
  await createServiceClient()
    .from('source_link_state')
    .upsert({ job: STATE_JOB, content_type: 'manga', ...patch }, { onConflict: 'job' });
}

export async function syncMangaLibCatalog(): Promise<MangaLibSyncResult> {
  const startedAt = new Date();
  await setState({ last_run_started_at: startedAt.toISOString(), last_error: null });

  try {
    // ── 1. Весь каталог MangaLib ──
    const items = new Map<number, MangaLibListItem>();
    let requests = 0;
    for (let page = 1; ; page++) {
      let res = await fetchMangaLibCatalogPage(page);
      requests++;
      for (const delay of RETRY_DELAYS_MS) {
        if (res) break;
        await sleep(delay);
        res = await fetchMangaLibCatalogPage(page);
        requests++;
      }
      if (!res) throw new Error(`MangaLib не отдал страницу ${page} каталога — обход прерван`);
      for (const item of res.items) items.set(item.id, item);
      if (!res.hasNext || res.items.length === 0) break;
    }
    if (items.size < MIN_SANE) {
      throw new Error(`MangaLib отдал всего ${items.size} тайтлов — каталог не меняю`);
    }

    // ── 2. Склейка с Remanga ──
    const names = await loadRemangaNames();
    const nowIso = new Date().toISOString();
    const sourceRows: object[] = [];
    const ownRows: object[] = [];

    // Один тайтл Remanga — одна пара. Второй тайтл MangaLib с тем же
    // совпадением (другое издание) идёт своей карточкой: иначе в одной пачке
    // upsert было бы две строки с одним ключом, и Postgres отклонил бы всё.
    const paired = new Set<number>();
    for (const item of items.values()) {
      let remangaId = matchRemanga(item, names);
      if (remangaId != null && paired.has(remangaId)) remangaId = null;
      if (remangaId != null) paired.add(remangaId);
      const title = item.rusName ?? item.engName ?? item.name ?? 'Без названия';
      const titleKey = remangaId ?? MANGALIB_KEY_OFFSET + item.id;

      sourceRows.push({
        content_type: 'manga',
        title_key: titleKey,
        source: 'mangalib',
        external_id: item.slugUrl,
        external_url: mangaLibSiteUrl(item.slugUrl),
        variant: 'default',
        title,
        language: 'ru',
        confidence: remangaId != null ? 0.95 : 1,
        is_active: true,
        updated_at: nowIso,
      });

      if (remangaId == null) {
        ownRows.push({
          title_id: titleKey,
          dir: `${MANGALIB_DIR_PREFIX}${item.slugUrl}`,
          title,
          original_title: item.engName ?? item.name,
          alternative_title: item.name,
          kind: item.kind,
          status: item.status,
          year: item.year,
          rating: item.rating,
          votes: item.votes,
          cover_url: mangaLibCover(item.coverRaw),
          source_url: mangaLibSiteUrl(item.slugUrl),
          in_catalog: true,
          updated_at: nowIso,
        });
      }
    }

    // ── 3. Запись ──
    await upsert('manga_index', ownRows, 'title_id');
    await upsert('title_sources', sourceRows, 'content_type,title_key,source,variant');

    // Карточки только с MangaLib, которых в его каталоге больше нет, — из
    // каталога (строки остаются ради «Продолжить»). Тайтлы Remanga не трогаем:
    // их наличие решает полный обход Remanga.
    const { error: sweepError } = await createServiceClient()
      .from('manga_index')
      .update({ in_catalog: false })
      .gte('title_id', MANGALIB_KEY_OFFSET)
      .eq('in_catalog', true)
      .lt('updated_at', startedAt.toISOString());

    const matched = items.size - ownRows.length;
    await setState({
      titles_total: items.size,
      titles_done: matched,
      last_cursor: ownRows.length,
      last_run_finished_at: new Date().toISOString(),
      last_error: sweepError ? `не снял исчезнувшие: ${sweepError.message}` : null,
    });

    return {
      titles: items.size,
      matched,
      ownCards: ownRows.length,
      requests,
      durationMs: Date.now() - startedAt.getTime(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setState({ last_run_finished_at: new Date().toISOString(), last_error: message });
    throw err;
  }
}
