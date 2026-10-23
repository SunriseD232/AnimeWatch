/**
 * Здоровье источников и kill-switch.
 *
 * Источник включается env-флагом (без деплоя) и дополнительно может быть
 * выключен в source_health.enabled из админки. Запись health — best-effort:
 * если БД недоступна, чтение контента не должно падать.
 */

import { createServiceClient } from '@/lib/supabase/service';
import type { SourceId } from './types';

/** env-флаг на источник. */
const ENV_FLAGS: Record<SourceId, string> = {
  remanga: 'SOURCE_REMANGA',
  mangadex: 'SOURCE_MANGADEX',
  mangalib: 'SOURCE_MANGALIB',
  selfmanga: 'SOURCE_SELFMANGA',
  mintmanga: 'SOURCE_MINTMANGA',
  yai: 'SOURCE_YAI',
  renovels: 'SOURCE_RENOVELS',
  flibusta: 'SOURCE_FLIBUSTA',
};

/** Что включено, если флаг не задан. */
const ENABLED_BY_DEFAULT = new Set<SourceId>([
  'remanga',
  'renovels',
  'mangadex',
  'mangalib',
  'selfmanga',
  'flibusta',
]);

function parseFlag(value: string | undefined): boolean | null {
  if (value == null || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'disabled'
  );
}

/** Включён ли источник по env-флагу. */
export function isSourceEnabled(source: SourceId): boolean {
  const flag = parseFlag(process.env[ENV_FLAGS[source]]);
  return flag ?? ENABLED_BY_DEFAULT.has(source);
}

export interface SourceHealthRow {
  source: string;
  enabled: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  errors_24h: number;
  latency_ms: number | null;
  updated_at: string;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

/**
 * Успех пишем не чаще раза в минуту на источник: иначе каждая страница
 * главы (12 запросов к MangaDex) давала бы 12 upsert'ов в БД без пользы.
 */
const OK_WRITE_INTERVAL_MS = 60_000;
const lastOkWriteAt = new Map<SourceId, number>();

/** Отметить успешный запрос. Не бросает. */
export async function recordSourceOk(
  source: SourceId,
  latencyMs: number,
): Promise<void> {
  const now = Date.now();
  const last = lastOkWriteAt.get(source) ?? 0;
  if (now - last < OK_WRITE_INTERVAL_MS) return;
  lastOkWriteAt.set(source, now);

  try {
    const supabase = createServiceClient();
    await supabase.from('source_health').upsert(
      {
        source,
        last_ok_at: new Date().toISOString(),
        latency_ms: Math.max(0, Math.round(latencyMs)),
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source' },
    );
  } catch {
    // health — не критичный путь.
  }
}

/** Отметить ошибку. Не бросает. */
export async function recordSourceError(
  source: SourceId,
  error: unknown,
): Promise<void> {
  try {
    const supabase = createServiceClient();

    const { data } = await supabase
      .from('source_health')
      .select('errors_24h')
      .eq('source', source)
      .maybeSingle();

    const current =
      data && typeof data.errors_24h === 'number' ? data.errors_24h : 0;

    await supabase.from('source_health').upsert(
      {
        source,
        last_error: errorText(error),
        errors_24h: current + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source' },
    );
  } catch {
    // health — не критичный путь.
  }
}

/** Все строки здоровья для админки. */
export async function getSourceHealth(): Promise<SourceHealthRow[]> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('source_health')
      .select(
        'source, enabled, last_ok_at, last_error, errors_24h, latency_ms, updated_at',
      )
      .order('source');

    if (error) return [];
    return (data ?? []) as SourceHealthRow[];
  } catch {
    return [];
  }
}
