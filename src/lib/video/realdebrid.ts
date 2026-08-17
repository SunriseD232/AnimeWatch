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
// Порог, отделяющий обычную раздачу (фильм ± сэмпл/сабы/постер) от
// мусорного "сборника" на сотни чужих файлов — см. комментарий у проверки
// ниже.
const MAX_FILES_IN_TORRENT = 20;

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
    if (!torrentId) return null;

    let info = await rdFetch<RdTorrentInfo>(`/torrents/info/${torrentId}`, key);
    if (info.status === 'waiting_files_selection') {
      const files = info.files ?? [];
      // Некоторые "торренты" на деле — мусорные сборники из сотен чужих
      // фильмов под одной раздачей (проверено вживую: топ-кандидат по
      // сидам для конкретного фильма оказался торрентом с files.length в
      // сотни, первым файлом по алфавиту — совсем другой фильм; Torrentio
      // отдал fileIdx=0, который тут ничего не значит). Индексу Torrentio
      // можно доверять только у обычных одно-/малофайловых раздач.
      console.log(`[rd-debug] ${infoHash} files.length=${files.length}`);
      if (files.length > MAX_FILES_IN_TORRENT) {
        console.log(`[rd-debug] ${infoHash} skipped: too many files`);
        return null;
      }
      const picked = pickFile(files, fileIdx);
      if (!picked) {
        console.log(`[rd-debug] ${infoHash} skipped: no video file found`);
        return null;
      }
      await rdFetch(`/torrents/selectFiles/${torrentId}`, key, {
        files: String(picked.id),
      });
      // Даже у уже закэшированного (мгновенного) торрента статус переходит
      // в "downloaded" не сразу после selectFiles — задержка на стороне
      // Real-Debrid бывает больше пары секунд, проверено вживую (кандидат,
      // вручную подтверждённый как закэшированный, не укладывался в старый
      // бюджет 3×500мс=1.5с и терялся). Раньше бюджет держали маленьким
      // из расчёта на последовательный перебор кандидатов — теперь кандидаты
      // идут параллельно (см. realdebridResolve.ts), общее время ограничено
      // самым медленным ОДНИМ кандидатом, так что можно позволить каждому
      // больше времени, не наказывая остальных.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        info = await rdFetch<RdTorrentInfo>(`/torrents/info/${torrentId}`, key);
        console.log(`[rd-debug] ${infoHash} poll#${attempt} status=${info.status}`);
        if (info.status !== 'waiting_files_selection' && info.status !== 'queued') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (info.status !== 'downloaded' || !info.links?.[0]) {
      console.log(`[rd-debug] ${infoHash} giving up: status=${info.status} links=${info.links?.length ?? 0}`);
      return null;
    }

    const unrestricted = await rdFetch<RdUnrestrict>('/unrestrict/link', key, {
      link: info.links[0],
    });
    if (!unrestricted.download) return null;

    return { url: unrestricted.download };
  } catch (err) {
    console.log(`[rd-debug] ${infoHash} threw:`, err);
    return null;
  } finally {
    // Не держим торрент в аккаунте — best-effort, не блокирует основной путь.
    if (torrentId) {
      rdFetch(`/torrents/delete/${torrentId}`, key).catch(() => {});
    }
  }
}
