/**
 * Клиент Real-Debrid — magnet-ссылка/инфохэш идёт на ИХ инфраструктуру (их
 * серверы участвуют в рое, не наши), в ответ — обычная HTTP-ссылка на файл.
 * Работает и на free-аккаунте (в отличие от AllDebrid, где magnet требует
 * премиум — проверено вживую).
 *
 * Все запросы идут через локальный VLESS-туннель (см. lib/net/vlessProxy.ts)
 * — без него устойчивая передача байт с этой VPS к их CDN обрывается на
 * ~16KB, тоже проверено вживую.
 */
import { vlessDispatcher } from '@/lib/net/vlessProxy';

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_TIMEOUT_MS = 8_000;

function apiKey(): string | undefined {
  return process.env.REALDEBRID_API_KEY;
}

interface RdFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

interface RdTorrentInfo {
  status: string;
  files?: RdFile[];
  links?: string[];
}

interface RdUnrestrict {
  download?: string;
}

const VIDEO_EXT = /\.(mp4|mkv|avi|webm|mov|m4v)$/i;

async function rdFetch<T>(
  path: string,
  key: string,
  body?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${RD_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
    signal: AbortSignal.timeout(RD_TIMEOUT_MS),
    // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
    dispatcher: vlessDispatcher(),
  });
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Индекс из Torrentio (fileIdx) → нужный файл, либо самый большой видео-
 *  файл в списке, если индекс не указывает на видео (см. тот же приём в
 *  историческом lib/video/alldebrid.ts — тут список уже плоский, без
 *  вложенных папок, как было у AllDebrid). */
function pickFile(files: RdFile[], fileIdx: number | null): RdFile | null {
  if (files.length === 0) return null;
  const byIndex = fileIdx != null ? files[fileIdx] : undefined;
  if (byIndex && VIDEO_EXT.test(byIndex.path)) return byIndex;
  const videoFiles = files.filter((f) => VIDEO_EXT.test(f.path));
  const pool = videoFiles.length > 0 ? videoFiles : files;
  return pool.reduce((a, b) => (b.bytes > a.bytes ? b : a));
}

/**
 * Инфохэш торрента → прямая ссылка на видеофайл через Real-Debrid, либо
 * null, если недоступно.
 *
 * Если торрент ещё не закэширован (после selectFiles статус не сразу
 * "downloaded") — не ждём реальную закачку, сразу null: вызывающий код (см.
 * realdebridResolve.ts) пробует следующий торрент из списка Torrentio.
 */
export async function resolveMagnetDirectUrl(
  infoHash: string,
  fileIdx: number | null,
): Promise<{ url: string } | null> {
  const key = apiKey();
  if (!key) return null;

  let torrentId: string | null = null;
  try {
    const added = await rdFetch<{ id: string }>('/torrents/addMagnet', key, {
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
    });
    torrentId = added.id;
    console.log('[rd-debug] added=', JSON.stringify(added));
    if (!torrentId) return null;

    let info = await rdFetch<RdTorrentInfo>(`/torrents/info/${torrentId}`, key);
    console.log('[rd-debug] info1=', JSON.stringify(info));
    if (info.status === 'waiting_files_selection') {
      const files = info.files ?? [];
      const picked = pickFile(files, fileIdx);
      console.log('[rd-debug] picked=', JSON.stringify(picked));
      if (!picked) return null;
      await rdFetch(`/torrents/selectFiles/${torrentId}`, key, {
        files: String(picked.id),
      });
      info = await rdFetch<RdTorrentInfo>(`/torrents/info/${torrentId}`, key);
      console.log('[rd-debug] info2=', JSON.stringify(info));
    }

    if (info.status !== 'downloaded' || !info.links?.[0]) return null;

    const unrestricted = await rdFetch<RdUnrestrict>('/unrestrict/link', key, {
      link: info.links[0],
    });
    console.log('[rd-debug] unrestricted=', JSON.stringify(unrestricted));
    if (!unrestricted.download) return null;

    return { url: unrestricted.download };
  } catch (err) {
    console.log('[rd-debug] EXCEPTION', err);
    return null;
  } finally {
    // Не держим торрент в аккаунте — best-effort, не блокирует основной путь.
    if (torrentId) {
      rdFetch(`/torrents/delete/${torrentId}`, key).catch(() => {});
    }
  }
}
