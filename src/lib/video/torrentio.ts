/**
 * Клиент неофициального публичного API аддона Torrentio (Stremio) —
 * индексатор торрентов по IMDb id (кино) и Kitsu id (аниме), агрегирует
 * несколько трекеров (YTS/EZTV/1337x/RARBG-зеркала/ThePirateBay/...).
 * Ничего не скачивает и не раздаёт сам — только отдаёт список
 * инфохэшей/названий, дальше инфохэш идёт в Real-Debrid (см. realdebrid.ts).
 *
 * Публичный, неофициальный — может измениться или стать недоступным без
 * предупреждения (сознательный выбор, обсуждали: инфраструктура взамен —
 * свой Jackett — тяжелее в поддержке).
 */

const TORRENTIO_BASE = 'https://torrentio.strem.fun';
const TORRENTIO_TIMEOUT_MS = 8_000;

export interface TorrentioStream {
  infoHash: string;
  /** Индекс файла ВНУТРИ торрента (важно для сезонных сборников — Torrentio
   *  уже сам сматчил нужную серию) — null, если аддон его не вернул. */
  fileIdx: number | null;
  title: string;
  seeders: number;
  /** Размер в байтах, если распарсили из title — null, если нет. */
  sizeBytes: number | null;
}

interface TorrentioRawStream {
  infoHash?: string;
  fileIdx?: number;
  title?: string;
  name?: string;
}

/** Число сидов зашито в текст title как «👤 12» — либо парсим, либо 0. */
function parseSeeders(title: string): number {
  const m = title.match(/👤\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** Размер зашит в title как «💾 777.02 MB» / «💾 58.3 GB». */
function parseSizeBytes(title: string): number | null {
  const m = title.match(/💾\s*([\d.]+)\s*(GB|MB)/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toUpperCase();
  return unit === 'GB' ? value * 1024 ** 3 : value * 1024 ** 2;
}

// 4K/UHD REMUX-раздачи (50-90GB) почти всегда идут первыми по числу сидов
// (у релиз-групп свои сидбоксы), но именно из-за размера редко закэшированы
// на дебрид-сервисе — проверено вживую: топ-3 по сидам для реального тайтла
// были все >15GB и ни один не сработал, а рабочий (закэшированный) вариант
// был на 4-й позиции. Сортируем «нормальные» размеры вперёд, а не режем
// огромные совсем — если ничего меньше нет, всё равно попробуем их.
const HUGE_FILE_BYTES = 15 * 1024 ** 3;

async function fetchStreams(path: string): Promise<TorrentioStream[]> {
  try {
    const res = await fetch(`${TORRENTIO_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TORRENTIO_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { streams?: TorrentioRawStream[] };
    return (data.streams ?? [])
      .filter((s): s is TorrentioRawStream & { infoHash: string } => !!s.infoHash)
      .map((s) => ({
        infoHash: s.infoHash,
        fileIdx: s.fileIdx ?? null,
        title: s.title ?? s.name ?? '',
        seeders: parseSeeders(s.title ?? ''),
        sizeBytes: parseSizeBytes(s.title ?? ''),
      }))
      .sort((a, b) => {
        const aHuge = (a.sizeBytes ?? 0) > HUGE_FILE_BYTES;
        const bHuge = (b.sizeBytes ?? 0) > HUGE_FILE_BYTES;
        if (aHuge !== bHuge) return aHuge ? 1 : -1;
        return b.seeders - a.seeders;
      });
  } catch {
    return [];
  }
}

/** Фильм по IMDb id (tt...). */
export function getMovieStreams(imdbId: string): Promise<TorrentioStream[]> {
  return fetchStreams(`/stream/movie/${imdbId}.json`);
}

/** Сериал (кино-раздел) по IMDb id + сезон/серия. */
export function getSeriesStreams(
  imdbId: string,
  season: number,
  episode: number,
): Promise<TorrentioStream[]> {
  return fetchStreams(`/stream/series/${imdbId}:${season}:${episode}.json`);
}

/** Аниме по Kitsu id + серия (у Torrentio аниме идёт через series-эндпоинт
 *  с префиксом kitsu:, не через свой anime-эндпоинт — проверено вживую). */
export function getAnimeStreams(
  kitsuId: number,
  episode: number,
): Promise<TorrentioStream[]> {
  return fetchStreams(`/stream/series/kitsu:${kitsuId}:${episode}.json`);
}
