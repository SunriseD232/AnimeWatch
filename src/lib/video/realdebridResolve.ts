import { getCinemaById } from '@/lib/videoseed-catalog';
import { getKitsuIdByMalId } from './kitsuMap';
import { getMovieStreams, getSeriesStreams, getAnimeStreams, type TorrentioStream } from './torrentio';
import { resolveMagnetDirectUrl } from './realdebrid';
import type { ResolvedStream } from '@/lib/extract/types';

/** Сколько кандидатов из Torrentio пробовать, пока не найдётся уже
 *  закэшированный на Real-Debrid (см. resolveMagnetDirectUrl — некэшированный
 *  торрент не ждём, сразу пробуем следующий). Каждая попытка — не больше
 *  нескольких секунд (см. цикл опроса в realdebrid.ts), так что верхняя
 *  граница ожидания ограничена даже при 6 кандидатах. */
const MAX_CANDIDATES = 6;

async function tryStreams(streams: TorrentioStream[]): Promise<ResolvedStream | null> {
  console.log('[rd-debug] candidates=', JSON.stringify(streams.slice(0, MAX_CANDIDATES).map((s) => ({ h: s.infoHash, seeders: s.seeders, size: s.sizeBytes }))));
  for (const stream of streams.slice(0, MAX_CANDIDATES)) {
    const direct = await resolveMagnetDirectUrl(stream.infoHash, stream.fileIdx);
    console.log('[rd-debug]', stream.infoHash, '->', direct);
    if (direct) return { url: direct.url, headers: {}, isHls: false };
  }
  return null;
}

async function cinemaStreams(
  kinopoiskId: number,
  season: number,
  episode: number,
): Promise<TorrentioStream[]> {
  const item = await getCinemaById(kinopoiskId);
  if (!item?.idImdb) return [];
  return item.isSerial
    ? getSeriesStreams(item.idImdb, season, episode)
    : getMovieStreams(item.idImdb);
}

async function animeStreams(shikimoriId: number, episode: number): Promise<TorrentioStream[]> {
  const kitsuId = await getKitsuIdByMalId(shikimoriId);
  if (!kitsuId) return [];
  return getAnimeStreams(kitsuId, episode);
}

/**
 * Резолвит эпизод через связку Torrentio (список торрентов по внешнему id)
 * + Real-Debrid (magnet → прямая ссылка, без P2P с нашей стороны — см.
 * lib/video/realdebrid.ts). Источник добавляется в общий пайплайн resolve.ts
 * как ещё один ExtractSource — кэшируется и проксируется тем же путём, что
 * Alloha/Videoseed/Kodik/etc.
 */
export async function resolveRealDebridStream({
  contentType,
  shikimoriId,
  season,
  episode,
}: {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
}): Promise<ResolvedStream | null> {
  const streams =
    contentType === 'cinema'
      ? await cinemaStreams(shikimoriId, season, episode)
      : await animeStreams(shikimoriId, episode);
  if (streams.length === 0) return null;
  return tryStreams(streams);
}
