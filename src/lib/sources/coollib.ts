import { vlessDispatcher } from '@/lib/net/vlessProxy';
import { decodeHtmlEntities } from '@/lib/sources/text';
import type { BookFormat } from '@/lib/bookShared';

/**
 * КулЛиб (coollib.cc) — запасной источник файлов книг (24.10.2026). Каталог
 * у нас свой — из дампа Флибусты, — а файл, когда Флибуста не отвечает,
 * ищем здесь по названию и фамилии автора.
 *
 * Проверено с VPS: OPDS тот же, что у Флибусты (/opds/search?searchType=
 * books), напрямую отвечает за ~0,2 с; FB2 отдаётся без входа (zip), EPUB —
 * не у всех книг (у них нет конвертации на лету). Номера книг свои, дампа нет.
 * Покрытие нашего каталога — 12–20 % (выборка 80 книг): у многих популярных
 * книг файл снят по требованию правообладателей — запись в поиске есть, а
 * ссылки на скачивание нет. Такие записи не считаются находкой.
 */

const BASES = ['https://coollib.cc', 'https://coollib.net'] as const;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15_000;

/** Сначала напрямую (coollib.cc с VPS открыт), не вышло — через туннель:
 *  coollib.net с VPS напрямую не отвечает, через туннель — да. */
async function get(path: string, accept: string): Promise<Response | null> {
  for (const base of BASES) {
    for (const viaTunnel of [false, true]) {
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: accept },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
          ...(viaTunnel ? { dispatcher: vlessDispatcher() } : {}),
        } as RequestInit);
        if (res.ok) return res;
        await res.arrayBuffer().catch(() => undefined);
        if (res.status === 404) return null;
      } catch {
        // следующий путь
      }
    }
  }
  return null;
}

function norm(value: string): string {
  return (decodeHtmlEntities(value) ?? value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .trim();
}

export interface CoollibMatch {
  id: number;
  formats: BookFormat[];
}

/**
 * Книга в КулЛибе: то же название (без скобок, ё = е) и фамилия автора в
 * списке авторов, и есть ссылка на скачивание. null — не нашли (или
 * нашли без файла); undefined — КулЛиб не ответил, решать нельзя.
 */
export async function findCoollibBook(title: string, author: string | null): Promise<CoollibMatch | null | undefined> {
  const surname = (author ?? '').split(',')[0].trim().split(/\s+/).pop() ?? '';
  const wantTitle = norm(title);
  const wantSurname = norm(surname);
  if (!wantTitle) return null;

  for (const term of [surname ? `${title} ${surname}` : title, title]) {
    const res = await get(
      `/opds/search?searchType=books&searchTerm=${encodeURIComponent(term)}`,
      'application/atom+xml',
    );
    if (!res) return undefined;
    const xml = await res.text();
    for (const entry of xml.split('<entry').slice(1)) {
      const entryTitle = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
      if (norm(entryTitle) !== wantTitle) continue;
      const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => norm(m[1]));
      if (wantSurname && !authors.some((a) => a.includes(wantSurname))) continue;
      const formats = new Set<BookFormat>();
      let id: number | null = null;
      for (const m of entry.matchAll(/\/b\/(\d+)\/(fb2|epub)"/g)) {
        id = Number(m[1]);
        formats.add(m[2] as BookFormat);
      }
      if (id != null && formats.size > 0) return { id, formats: [...formats] };
    }
  }
  return null;
}

/** Файл книги. Проверяем сигнатуру: вместо файла КулЛиб иногда отдаёт HTML
 *  («нет книги», вход) с кодом 200. */
export async function fetchCoollibFile(id: number, format: BookFormat): Promise<ArrayBuffer | null> {
  const res = await get(`/b/${id}/${format}`, '*/*');
  if (!res) return null;
  const body = await res.arrayBuffer();
  const bytes = new Uint8Array(body);
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isXml = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().startsWith('<?xml');
  if (format === 'epub' ? !isZip : !isZip && !isXml) return null;
  return body;
}
