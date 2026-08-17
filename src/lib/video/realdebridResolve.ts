import { getCinemaById } from '@/lib/videoseed-catalog';
import { getKitsuIdByMalId } from './kitsuMap';
import { getMovieStreams, getSeriesStreams, getAnimeStreams, type TorrentioStream } from './torrentio';
import { resolveMagnetDirectUrl } from './realdebrid';
import type { ResolvedStream } from '@/lib/extract/types';

/** Сколько кандидатов из Torrentio пробовать, пока не найдётся уже
 *  закэшированный на Real-Debrid (см. resolveMagnetDirectUrl — некэшированный
 *  торрент не ждём, сразу пробуем следующий). Каждая попытка — не больше
 *  RD_TIMEOUT_MS, так что верхняя граница ожидания ограничена. */
const MAX_CANDIDATES = 3;

async function tryStreams(streams: TorrentioStream[]): Promise<ResolvedStream | null> {
  console.log('[rd-debug] tryStreams count=', streams.length);
  for (const stream of streams.slice(0, MAX_CANDIDATES)) {
    console.log('[rd-debug] trying', stream.infoHash, stream.fileIdx);
    const direct = await resolveMagnetDirectUrl(stream.infoHash, stream.fileIdx);
    console.log('[rd-debug] result', direct);
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
  console.log('[rd-debug] item.idImdb=', item?.idImdb, 'isSerial=', item?.isSerial);
  if (!item?.idImdb) return [];
  const streams = item.isSerial
    ? await getSeriesStreams(item.idImdb, season, episode)
    : await getMovieStreams(item.idImdb);
  console.log('[rd-debug] torrentio streams=', streams.length);
  return streams;
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
