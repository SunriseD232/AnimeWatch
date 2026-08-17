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
 * через addMagnet. Компенсируем это широким пулом кандидатов ЗАПУЩЕННЫХ
 * ПАРАЛЛЕЛЬНО (см. tryStreams) — на популярных тайтлах топ по сидам часто
 * состоит из 4K/UHD-релизов, которые редко закэшированы, а рабочий вариант
 * может быть 8-м–15-м в списке; при последовательном переборе это было бы
 * непозволительно долго, при параллельном — общее время ограничено самым
 * медленным ОДНИМ кандидатом, а не суммой всех.
 */
const MAX_CANDIDATES = 15;

async function tryStreams(streams: TorrentioStream[]): Promise<ResolvedStream | null> {
  const candidates = streams.slice(0, MAX_CANDIDATES);
  const results = await Promise.all(
    candidates.map((s) => resolveMagnetDirectUrl(s.infoHash, s.fileIdx)),
  );
  // find(), не результат гонки — сохраняем приоритет исходной сортировки
  // (по сидам/размеру, см. torrentio.ts), даже если менее приоритетный
  // кандидат ответил быстрее.
  const direct = results.find((r): r is { url: string } => r !== null);
  return direct ? { url: direct.url, headers: {}, isHls: false } : null;
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
