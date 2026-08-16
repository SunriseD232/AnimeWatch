/**
 * Клиент AllDebrid — magnet-ссылка/инфохэш идёт на ИХ инфраструктуру (их
 * серверы участвуют в рое, не наши), в ответ — обычная HTTP-ссылка на файл,
 * как у любого другого файлообменника. Наш сервер никогда не подключается к
 * пирам напрямую (обсуждали архитектуру и риски отдельно).
 *
 * Требует платный (премиум) аккаунт — на free без подписки /magnet/upload
 * отвечает ошибкой MAGNET_MUST_BE_PREMIUM, проверено вживую.
 */

const ALLDEBRID_API = 'https://api.alldebrid.com/v4';
const ALLDEBRID_TIMEOUT_MS = 8_000;
// Обязательный параметр агента у AllDebrid API — просто идентификатор
// клиента в их логах, не секрет.
const AGENT = 'mediawatch';

function apiKey(): string | undefined {
  return process.env.ALLDEBRID_API_KEY;
}

interface AllDebridFile {
  n: string;
  s: number;
  l: string;
}

interface UploadResponse {
  status: string;
  data?: { magnets?: { id?: number; ready?: boolean }[] };
}

interface FilesResponse {
  status: string;
  data?: { magnets?: { files?: AllDebridFile[] }[] };
}

interface UnlockResponse {
  status: string;
  data?: { link?: string };
}

const VIDEO_EXT = /\.(mp4|mkv|avi|webm|mov|m4v)$/i;

async function adPost<T>(path: string, key: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${ALLDEBRID_API}${path}?agent=${AGENT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(ALLDEBRID_TIMEOUT_MS),
  });
  return (await res.json()) as T;
}

/** Из плоского списка файлов торрента выбирает нужный: по fileIdx (индекс
 *  внутри торрента, уже сматченный Torrentio на нужную серию), если он
 *  указывает на видеофайл, иначе — самый большой видеофайл в списке
 *  (сэмплы/трейлеры/суб-файлы обычно на порядки меньше самой серии). */
function pickFile(files: AllDebridFile[], fileIdx: number | null): AllDebridFile | null {
  if (files.length === 0) return null;
  const byIndex = fileIdx != null ? files[fileIdx] : undefined;
  if (byIndex && VIDEO_EXT.test(byIndex.n)) return byIndex;
  const videoFiles = files.filter((f) => VIDEO_EXT.test(f.n));
  const pool = videoFiles.length > 0 ? videoFiles : files;
  return pool.reduce((a, b) => (b.s > a.s ? b : a));
}

/**
 * Инфохэш торрента → прямая ссылка на видеофайл через AllDebrid, либо null,
 * если недоступно (нет ключа/не премиум/апстрим не ответил).
 *
 * Если торрент ещё не закэширован на инфраструктуре AllDebrid (`ready:
 * false`) — не ждём реальную закачку (может занять сколько угодно), сразу
 * возвращаем null: вызывающий код (см. alldebridResolve.ts) пробует
 * следующий торрент из списка Torrentio вместо того, чтобы держать
 * пользователя на скелетоне неопределённое время.
 */
export async function resolveMagnetDirectUrl(
  infoHash: string,
  fileIdx: number | null,
): Promise<{ url: string } | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const upload = await adPost<UploadResponse>('/magnet/upload', key, {
      'magnets[]': `magnet:?xt=urn:btih:${infoHash}`,
    });
    if (upload.status !== 'success') return null;
    const magnet = upload.data?.magnets?.[0];
    if (!magnet?.ready || magnet.id == null) return null;

    const filesRes = await adPost<FilesResponse>('/magnet/files', key, {
      'id[]': String(magnet.id),
    });
    const files = filesRes.data?.magnets?.[0]?.files ?? [];
    const picked = pickFile(files, fileIdx);
    if (!picked) return null;

    const unlock = await adPost<UnlockResponse>('/link/unlock', key, {
      link: picked.l,
    });
    if (unlock.status !== 'success' || !unlock.data?.link) return null;

    return { url: unlock.data.link };
  } catch {
    return null;
  }
}
