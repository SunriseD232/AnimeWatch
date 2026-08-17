import { getCinemaById } from '@/lib/videoseed-catalog';
import { getKitsuIdByMalId } from './kitsuMap';
import { getMovieStreams, getSeriesStreams, getAnimeStreams, type TorrentioStream } from './torrentio';
import { resolveMagnetDirectUrl } from './realdebrid';
import type { ResolvedStream } from '@/lib/extract/types';

/**
 * Сколько кандидатов из Torrentio пробовать. Real-Debrid отключил
 * instantAvailability (проверено вживую: "disabled_endpoint" — раньше
 * позволял batch-проверкой узнать закэшированные хэши без добавления в
 * аккаунт, теперь эту лазейку прикрыли у всех дебрид-сервисов), так что
 * единственный способ узнать, закэширован ли торрент — реально попробовать
 * через addMagnet. Компенсируем это широким пулом кандидатов — на
 * популярных тайтлах топ по сидам часто состоит из 4K/UHD-релизов, которые
 * редко закэшированы, а рабочий вариант может быть 8-м–15-м в списке.
 *
 * Перебор СТРОГО последовательный, не параллельный — проверено вживую: наш
 * VLESS-туннель к Real-Debrid (см. realdebrid.ts) полностью зависает при
 * ЛЮБЫХ двух одновременных запросах, даже с mux в конфиге Xray. Параллельный
 * Promise.all по кандидатам однажды заваливал вообще все 15 кандидатов сразу
 * (каждый рано или поздно бьёт в этот затор). Последовательно с ранним
 * выходом на первом успехе — почти всегда быстрее по факту: "мимо" кандидат
 * стоит 1-2 запроса (addMagnet + info) без опроса статуса, дорогой опрос
 * (до 6×1с) платится только один раз — на кандидате, который сработал.
 */
const MAX_CANDIDATES = 15;

async function tryStreams(streams: TorrentioStream[]): Promise<ResolvedStream | null> {
  const candidates = streams.slice(0, MAX_CANDIDATES);
  for (const candidate of candidates) {
    const direct = await resolveMagnetDirectUrl(candidate.infoHash, candidate.fileIdx);
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
