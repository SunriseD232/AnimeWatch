/**
 * Извлечение видео из AniLibria.
 * AniLibria — единственный источник, который даёт прямые HLS-ссылки
 * без embed-плеера. API публичный, без токена.
 *
 * Алгоритм повторяет логику из src/lib/anilibria.ts.
 */

const API = 'https://anilibria.top/api/v1';

interface AniName {
  main: string | null;
  english: string | null;
  alternative: string | null;
}

interface AniSearchItem {
  id: number;
  alias: string;
  year: number | null;
  name: AniName;
}

interface AniEpisode {
  id: string;
  ordinal: number;
  hls_480: string | null;
  hls_720: string | null;
  hls_1080: string | null;
}

interface AniRelease {
  id: number;
  alias: string;
  year: number | null;
  name: AniName;
  is_blocked_by_geo: boolean;
  episodes: AniEpisode[];
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function searchReleases(query: string): Promise<AniSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await safeJson<AniSearchItem[] | { data: AniSearchItem[] }>(
    `${API}/app/search/releases?query=${encodeURIComponent(q)}`,
  );
  if (!data) return [];
  return Array.isArray(data) ? data : (data.data ?? []);
}

async function getRelease(id: number): Promise<AniRelease | null> {
  return safeJson<AniRelease>(`${API}/anime/releases/${id}`);
}

/**
 * Пытается найти AniLibria-релиз по shikimori_id через поиск по названию.
 * В реальном проекте используется romaji/russian/year из Shikimori.
 * Здесь мы не имеем названия, поэтому делаем fallback на поиск.
 *
 * На практике бот должен получать romaji/russian/year из задачи.
 * Для упрощения — шаг пропускается, если названия нет.
 */

/**
 * Извлекает HLS-ссылку из AniLibria по данным тайтла.
 * shikimoriId — не используется напрямую (у AniLibria нет shikimori_id).
 * Вместо этого нужно передавать romaji и russian названия.
 *
 * Для бота задача должна содержать anime_title, по которому ищем.
 */
export async function extractAnilibria(
  shikimoriId: number,
  episode: number,
): Promise<string | null> {
  // К сожалению, без romaji/russian/year из Shikimori API точный поиск
  // по AniLibria невозможен. Нужно либо:
  // 1. Хранить romaji/russian в задаче
  // 2. Вызывать Shikimori API здесь
  //
  // Пока оставляем заглушку. В реальности нужно получать названия из задачи.
  // Для теста можно использовать getAnime(shikimoriId) из Shikimori API.

  // Пробуем получить через Shikimori API.
  const shikimoriRes = await fetch(
    `https://shikimori.one/api/animes/${shikimoriId}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!shikimoriRes.ok) return null;

  const anime: { name: string; russian: string; aired_on?: string } | null =
    await shikimoriRes.json().catch(() => null);
  if (!anime) return null;

  const romaji = anime.name;
  const russian = anime.russian || anime.name;
  const year = anime.aired_on
    ? Number(anime.aired_on.slice(0, 4)) || null
    : null;

  // Ищем релиз.
  const queries = [russian, romaji].filter(Boolean);
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

  const nr = norm(romaji);
  const nru = norm(russian);

  let best: { id: number; score: number } | null = null;
  for (const it of items) {
    const ne = norm(it.name.english);
    const nm = norm(it.name.main);
    const na = norm(it.name.alternative);

    let score = 0;
    if (nr && ne && ne === nr) score += 100;
    else if (nr && na && na === nr) score += 90;
    if (nru && nm && nm === nru) score += 80;

    if (year && it.year) {
      if (it.year === year) score += 20;
      else if (Math.abs(it.year - year) <= 1) score += 8;
      else score -= 25;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { id: it.id, score };
    }
  }

  if (!best || best.score < 80) return null;

  const rel = await getRelease(best.id);
  if (!rel || rel.is_blocked_by_geo) return null;

  // Ищем эпизод.
  const eps = [...rel.episodes].sort(
    (a, b) => a.ordinal - b.ordinal,
  );
  const ep = eps.find((e) => e.ordinal === episode) ?? eps[episode - 1];
  if (!ep) return null;

  // Берём лучшее качество.
  return ep.hls_1080 || ep.hls_720 || ep.hls_480 || null;
}
