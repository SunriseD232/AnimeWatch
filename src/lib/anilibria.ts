/**
 * Клиент AniLibria API v1 (исполняется в браузере — так поток получает
 * корректную гео-привязку по IP пользователя, а не сервера).
 *
 * Внешних id (MAL/Shikimori) в API нет, поэтому сопоставление тайтла идёт
 * по ромадзи-названию (`name.english`) и русскому (`name.main`) + году.
 */

const API = 'https://anilibria.top/api/v1';

export type QualityLabel = '1080' | '720' | '480';

export interface HlsQuality {
  label: QualityLabel;
  url: string;
}

interface AniName {
  main: string | null;
  english: string | null;
  alternative: string | null;
}

export interface AniEpisode {
  id: string;
  ordinal: number;
  sort_order?: number;
  name: string | null;
  duration: number;
  hls_480: string | null;
  hls_720: string | null;
  hls_1080: string | null;
}

export interface AniRelease {
  id: number;
  alias: string;
  year: number | null;
  name: AniName;
  episodes_total: number | null;
  is_blocked_by_geo: boolean;
  episodes: AniEpisode[];
}

interface AniSearchItem {
  id: number;
  alias: string;
  year: number | null;
  name: AniName;
}

/** Нормализация названия для сравнения. */
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function searchReleases(
  query: string,
): Promise<AniSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await safeJson<AniSearchItem[] | { data: AniSearchItem[] }>(
    `${API}/app/search/releases?query=${encodeURIComponent(q)}`,
  );
  if (!data) return [];
  return Array.isArray(data) ? data : (data.data ?? []);
}

export async function getRelease(id: number): Promise<AniRelease | null> {
  return safeJson<AniRelease>(`${API}/anime/releases/${id}`);
}

/**
 * Ищет релиз AniLibria, соответствующий тайтлу Shikimori.
 * Возвращает id релиза или null (тогда используется fallback Kodik).
 * Порог намеренно строгий: лучше не найти, чем сыграть чужой тайтл.
 */
export async function resolveReleaseId(opts: {
  romaji: string;
  russian: string;
  year: number | null;
}): Promise<number | null> {
  const queries = [opts.russian, opts.romaji].filter(Boolean);
  const seen = new Set<number>();
  const items: AniSearchItem[] = [];
  for (const q of queries) {
    const found = await searchReleases(q);
    for (const it of found) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        items.push(it);
      }
    }
  }

  const nr = norm(opts.romaji);
  const nru = norm(opts.russian);

  let best: { id: number; score: number } | null = null;
  for (const it of items) {
    const ne = norm(it.name.english);
    const nm = norm(it.name.main);
    const na = norm(it.name.alternative);

    let score = 0;
    // Ромадзи
    if (nr && ne && ne === nr) score += 100;
    else if (nr && na && na === nr) score += 90;
    // Русское
    if (nru && nm && nm === nru) score += 80;

    // Год как подтверждение/штраф
    if (opts.year && it.year) {
      if (it.year === opts.year) score += 20;
      else if (Math.abs(it.year - opts.year) <= 1) score += 8;
      else score -= 25;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { id: it.id, score };
    }
  }

  // Принимаем только уверенное совпадение (точный ромадзи или точное русское).
  return best && best.score >= 80 ? best.id : null;
}

/**
 * Выбирает эпизод: сначала по ordinal === episode, иначе по позиции
 * (episode-1) в отсортированном списке — покрывает и обычную нумерацию,
 * и продолжения с абсолютной нумерацией.
 */
export function pickEpisode(
  rel: AniRelease,
  episode: number,
): AniEpisode | null {
  const eps = [...rel.episodes].sort(
    (a, b) => (a.sort_order ?? a.ordinal) - (b.sort_order ?? b.ordinal),
  );
  const exact = eps.find((e) => e.ordinal === episode);
  if (exact) return exact;
  return eps[episode - 1] ?? null;
}

/** Доступные качества эпизода, от большего к меньшему. */
export function episodeQualities(ep: AniEpisode): HlsQuality[] {
  const out: HlsQuality[] = [];
  if (ep.hls_1080) out.push({ label: '1080', url: ep.hls_1080 });
  if (ep.hls_720) out.push({ label: '720', url: ep.hls_720 });
  if (ep.hls_480) out.push({ label: '480', url: ep.hls_480 });
  return out;
}
