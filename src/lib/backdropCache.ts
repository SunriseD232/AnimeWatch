import { mkdir, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';
import type { BackdropKind } from '@/lib/backdropPath';

/**
 * Локальный кэш hero-обложек (см. миграцию 0042) — узкая версия
 * lib/posterCache.ts. Разница с постерами: тот сам обходит партиями ВЕСЬ
 * каталог, а этот получает готовый список кандидатов от крона рекомендаций
 * (lib/recommendationsEngine.ts) — только тайтлы, которые реально стали
 * чьим-то hero сегодня, десятки записей в сутки, не весь индекс.
 */

const BACKDROP_DIR = process.env.BACKDROP_DIR ?? '/opt/mediawatch/backdrops';

// Hero — полноэкранный баннер, не карточка 2:3 (см. TARGET_WIDTH=480 у
// постеров): ширина побольше, но не оригинал в 3360px — на телефоне это
// всё равно уменьшается, а на диске и в трафике лишние мегабайты.
const TARGET_WIDTH = 1600;
const WEBP_QUALITY = 82;
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 20_000;

function filePath(kind: BackdropKind, id: number): string {
  return join(BACKDROP_DIR, kind, `${id}.webp`);
}

export interface BackdropCandidate {
  kind: BackdropKind;
  id: number;
  url: string;
}

interface CacheRow {
  kind: string;
  source_id: number;
  source_url: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  fetched_at: string;
  miss_count: number;
}

/** Скачивает и пережимает одну обложку. null — сетевая неудача (не отмечаем
 *  проверенной, см. fetchAndStore в posterCache.ts — тот же приём). */
async function fetchAndStore(
  kind: BackdropKind,
  id: number,
  url: string,
): Promise<{ bytes: number; width: number | null; height: number | null } | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'MediaWatch MVP' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 403) {
      return { bytes: 0, width: null, height: null };
    }
    if (!res.ok) return null;

    const input = Buffer.from(await res.arrayBuffer());
    if (input.length === 0) return { bytes: 0, width: null, height: null };

    const output = await sharp(input)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const target = filePath(kind, id);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, output.data);
    await rename(tmp, target);

    return {
      bytes: output.data.length,
      width: output.info.width ?? null,
      height: output.info.height ?? null,
    };
  } catch {
    return null;
  }
}

export interface BackdropCacheResult {
  attempted: number;
  stored: number;
  missed: number;
  failed: number;
  bytes: number;
  /** kind:id -> лежит ли файл на диске ПОСЛЕ этого прогона (учитывает и уже
   *  скачанные ранее, и только что скачанные) — по этому решает вызывающий
   *  код (recommendationsEngine.ts), отдавать localBackdropUrl или ссылку
   *  на апстрим напрямую. */
  resolved: Map<string, boolean>;
}

/**
 * Докачивает backdrop'ы для переданного списка кандидатов, пропуская уже
 * скачанные по актуальной ссылке (апстрим сменил ссылку — перекачиваем).
 * Не бросает: одна неудачная закачка не должна ронять весь прогон крона.
 */
export async function cacheBackdrops(
  candidates: BackdropCandidate[],
): Promise<BackdropCacheResult> {
  if (candidates.length === 0) {
    return { attempted: 0, stored: 0, missed: 0, failed: 0, bytes: 0, resolved: new Map() };
  }

  const supabase = createServiceClient();

  // Дедуп по (kind, id) — разные пользователи вполне могут получить одного
  // и того же hero-кандидата в один день.
  const uniqueByKey = new Map<string, BackdropCandidate>();
  for (const c of candidates) uniqueByKey.set(`${c.kind}:${c.id}`, c);
  const unique = [...uniqueByKey.values()];

  const known = new Map<string, { url: string | null; ok: boolean }>();
  for (const kind of ['anime', 'cinema'] as BackdropKind[]) {
    const ids = unique.filter((c) => c.kind === kind).map((c) => c.id);
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from('backdrop_cache')
      .select('source_id, source_url, bytes')
      .eq('kind', kind)
      .in('source_id', ids);
    for (const r of data ?? []) {
      const row = r as { source_id: number; source_url: string | null; bytes: number | null };
      known.set(`${kind}:${row.source_id}`, { url: row.source_url, ok: (row.bytes ?? 0) > 0 });
    }
  }

  // Качаем то, чего нет, либо то, у чего сменилась ссылка апстрима (URL
  // содержит хеш файла — сменился URL, сменилась и картинка). Уже успешно
  // скачанное по той же ссылке — пропускаем, hero меняется у пользователей
  // каждый день, а сам файл тайтла — почти никогда.
  const todo = unique.filter((c) => {
    const prev = known.get(`${c.kind}:${c.id}`);
    return !prev || !prev.ok || prev.url !== c.url;
  });

  let stored = 0;
  let missed = 0;
  let failed = 0;
  let bytes = 0;

  // Уже лежащие на диске по актуальной ссылке — сразу resolved: true, их
  // cacheBackdrops в этом прогоне не трогает вовсе.
  const resolved = new Map<string, boolean>();
  for (const c of unique) {
    const key = `${c.kind}:${c.id}`;
    if (!todo.includes(c)) resolved.set(key, known.get(key)?.ok ?? false);
  }

  const results = await mapWithConcurrency(todo, CONCURRENCY, async (c) => ({
    c,
    res: await fetchAndStore(c.kind, c.id, c.url),
  }));

  const rows: CacheRow[] = [];
  for (const { c, res } of results) {
    const key = `${c.kind}:${c.id}`;
    if (res === null) {
      failed++;
      // Сетевая неудача — не трогаем прежнее состояние файла (его вообще
      // не пытались перезаписать), просто не отмечаем проверенным.
      resolved.set(key, known.get(key)?.ok ?? false);
      continue;
    }
    if (res.bytes === 0) {
      missed++;
      resolved.set(key, false);
    } else {
      stored++;
      bytes += res.bytes;
      resolved.set(key, true);
    }
    rows.push({
      kind: c.kind,
      source_id: c.id,
      source_url: c.url,
      bytes: res.bytes,
      width: res.width,
      height: res.height,
      fetched_at: new Date().toISOString(),
      miss_count: res.bytes === 0 ? (known.get(key)?.ok === false ? 1 : 1) : 0,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('backdrop_cache')
      .upsert(rows, { onConflict: 'kind,source_id' });
    if (error) console.error('[backdropCache] не записался backdrop_cache:', error.message);
  }

  return { attempted: todo.length, stored, missed, failed, bytes, resolved };
}
