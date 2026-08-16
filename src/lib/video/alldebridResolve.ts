import { getCinemaById } from '@/lib/videoseed-catalog';
import { getKitsuIdByMalId } from './kitsuMap';
import { getMovieStreams, getSeriesStreams, getAnimeStreams, type TorrentioStream } from './torrentio';
import { resolveMagnetDirectUrl } from './alldebrid';
import type { ResolvedStream } from '@/lib/extract/types';

/** Сколько кандидатов из Torrentio пробовать, пока не найдётся уже
 *  закэшированный на AllDebrid (см. resolveMagnetDirectUrl — некэшированный
 *  торрент не ждём, сразу пробуем следующий). Каждая попытка — не больше
 *  ALLDEBRID_TIMEOUT_MS, так что верхняя граница ожидания ограничена. */
const MAX_CANDIDATES = 3;

async function tryStreams(streams: TorrentioStream[]): Promise<ResolvedStream | null> {
  for (const stream of streams.slice(0, MAX_CANDIDATES)) {
    const direct = await resolveMagnetDirectUrl(stream.infoHash, stream.fileIdx);
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
 * + AllDebrid (magnet → прямая ссылка, без P2P с нашей стороны — см.
 * lib/video/alldebrid.ts). Источник добавляется в общий пайплайн resolve.ts
 * как ещё один ExtractSource — кэшируется и проксируется тем же путём, что
 * Alloha/Videoseed/Kodik/etc.
 */
export async function resolveAllDebridStream({
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
