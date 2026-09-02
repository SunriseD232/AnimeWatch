import { createServiceClient } from '@/lib/supabase/service';

/**
 * Внешние субтитры через OpenSubtitles — источник субтитров, не привязанный
 * к конкретному видео-экстрактору (в отличие от Videoseed's .vtt, см.
 * vps-extractor/src/videoseed.js — те при извлечении видео, эти отдельно по
 * названию/imdb_id). Закрывает то, что Videoseed не даёт: аниме и сериалы
 * (у Videoseed в каталоге `subs` есть только у части фильмов, см. коммит).
 *
 * Кэшируется НАВСЕГДА в subtitle_cache (см. миграцию 0012) — бесплатный
 * тариф API даёт всего 100 скачиваний/сутки НА ВЕСЬ САЙТ, а текст субтитров
 * серии не меняется. vtt=null в кэше — тоже валидный результат ("искали, не
 * нашли"), чтобы не тратить квоту повторно на каждый визит.
 *
 * Матчинг:
 *  - Кино — точный, по imdb_id (см. CinemaFull.idImdb в videoseed-catalog.ts,
 *    приходит из TMDB) + season/episode для сериалов.
 *  - Аниме — Shikimori не даёт imdb_id напрямую, поэтому приблизительный
 *    поиск по английскому названию (ShikimoriAnimeFull.name) + номеру серии,
 *    С ВАЛИДАЦИЕЙ совпадения — лучше отсутствие субтитра, чем субтитр не от
 *    той серии/тайтла.
 */

const API_BASE = 'https://api.opensubtitles.com/api/v1';
const UA = 'MediaWatch v1.0';

function apiKey(): string | undefined {
  return process.env.OPENSUBTITLES_API_KEY;
}

interface OsFeatureDetails {
  feature_type?: string;
  title?: string;
  parent_title?: string;
  season_number?: number;
  episode_number?: number;
}

interface OsSubtitleAttributes {
  language: string;
  download_count: number;
  files: { file_id: number; file_name?: string }[];
  feature_details?: OsFeatureDetails;
}

interface OsSearchResponse {
  data?: { attributes: OsSubtitleAttributes }[];
}

async function osFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const key = apiKey();
  if (!key) {
    // Раньше падало молча — снаружи выглядело неотличимо от «искали, не
    // нашли» (см. getCachedSubtitle: и то, и это кэшируется как vtt=null
    // навсегда). Один явный лог на весь процесс жизни ключа стоит того,
    // чтобы больше не гадать вслепую при разборе таких жалоб.
    console.error('[opensubtitles] OPENSUBTITLES_API_KEY не задан в окружении');
    return null;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Api-Key': key,
        'User-Agent': UA,
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        `[opensubtitles] ${path} status=${res.status} body=${body.slice(0, 300)}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(
      `[opensubtitles] ${path} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё ]/gi, '')
    .trim();
}

/** Грубая эвристика совпадения названий — точное совпадение или взаимное
 *  вложение подстрок (после нормализации). Строже (пороги схожести и т.п.)
 *  не нужно — цель не идеальный fuzzy-матчинг, а просто отсеять явный
 *  промах не по тому тайтлу. */
function titlesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** SRT → WebVTT: запятая→точка в таймкодах, снос ASS override-тегов вида
 *  {\an8}, которые в VTT ничего не значат и показались бы как текст. */
function srtToVtt(srt: string): string {
  const cleaned = srt
    .replace(/^﻿/, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${cleaned.trim()}\n`;
}

function normalizeImdbId(id: string): string {
  return id.replace(/^tt/i, '');
}

/** Читает тело ответа чанками со своим таймаутом ПРОСТОЯ (а не одним общим
 *  на весь запрос) — воспроизведено вживую: файл-сервер OpenSubtitles
 *  (www.opensubtitles.com/download/...) отдаёт весь .srt за доли секунды, но
 *  саму TCP-сессию после этого не закрывает (ни финального чанка, ни FIN) —
 *  ни curl, ни Node fetch НИКОГДА не дожидаются res.text()/конца потока сами,
 *  виснут до внешнего таймаута. Раз данные пришли, а новых больше не
 *  появляется — считаем поток завершённым. hardCapMs — на случай, если файл
 *  реально идёт медленной, но непрерывной трусцой (каждый чанк сбрасывает
 *  таймер простоя, иначе такой случай никогда бы не досчитался до конца).
 */
async function readBodyWithIdleTimeout(
  body: ReadableStream<Uint8Array>,
  idleMs = 3_000,
  hardCapMs = 20_000,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + hardCapMs;
  try {
    while (Date.now() < deadline) {
      let timer!: ReturnType<typeof setTimeout>;
      const idle = new Promise<'idle'>((resolve) => {
        timer = setTimeout(() => resolve('idle'), idleMs);
      });
      const result = await Promise.race([reader.read(), idle]);
      clearTimeout(timer);
      if (result === 'idle' || result.done) break;
      text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function downloadAsVtt(fileId: number): Promise<string | null> {
  const data = await osFetch<{ link?: string }>('/download', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!data?.link) return null;
  try {
    // ВАЖНО: AbortSignal живёт весь запрос целиком (в т.ч. чтение тела через
    // res.body), а не только до заголовков — так и родилась первая версия
    // этого фикса, которая на деплое продолжала падать с тем же "aborted due
    // to timeout": 15-секундный таймаут срабатывал ПОВЕРХ уже идущего
    // idle-чтения ниже и обрывал его раньше времени. Поэтому свой контроллер
    // и таймер СНИМАЕМ сразу, как только пришли заголовки — дальше телом
    // целиком владеет readBodyWithIdleTimeout со своей логикой простоя.
    const connectController = new AbortController();
    const connectTimer = setTimeout(() => connectController.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(data.link, { signal: connectController.signal });
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res.ok) {
      console.error(`[opensubtitles] download file_id=${fileId} status=${res.status}`);
      return null;
    }
    const srt = res.body
      ? await readBodyWithIdleTimeout(res.body)
      : await res.text();
    if (!srt.trim()) {
      console.error(`[opensubtitles] download file_id=${fileId} — пустое тело`);
      return null;
    }
    return srtToVtt(srt);
  } catch (err) {
    console.error(
      `[opensubtitles] download file_id=${fileId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

interface FindArgs {
  lang: string;
  episode: number;
  /** Для сериалов — номер сезона (только вместе с imdbId: у аниме своя,
   *  несовместимая с OpenSubtitles нумерация сезонов, поэтому там ищем без
   *  него, просто по номеру серии). */
  season?: number;
  /** "tt1234567" или голое число — есть только у кино (см. CinemaFull.idImdb). */
  imdbId?: string | null;
  /** Название для поиска у аниме (imdbId нет) — обычно ShikimoriAnimeFull.name. */
  title?: string;
}

/** Результат поиска — раздельно от того, ЗНАЕМ ли мы уже точно, что субтитра
 *  нет (можно смело кэшировать null навсегда), или просто не смогли сейчас
 *  получить ответ (сеть/квота/зависший download — см. getCachedSubtitle:
 *  такое кэшировать НЕЛЬЗЯ, иначе один временный сбой навсегда прячет
 *  реально существующий субтитр — именно это произошло с «Пацаны», где
 *  зависание TCP-сессии на файл-сервере OpenSubtitles молча кэшировалось
 *  как «искали, не нашли»). */
interface FindResult {
  vtt: string | null;
  /** true — точно знаем результат (нашли, либо честно не нашли/не прошло
   *  валидацию); false — не смогли выяснить (ключ/сеть/квота/зависший
   *  download) и результат кэшировать нельзя. */
  confirmed: boolean;
}

/** Ищет и скачивает лучший субтитр под критерии — БЕЗ кэширования (кэш см.
 *  getCachedSubtitle ниже). */
async function findSubtitle({ lang, episode, season, imdbId, title }: FindArgs): Promise<FindResult> {
  if (!apiKey()) return { vtt: null, confirmed: false };

  const params = new URLSearchParams({ languages: lang });
  if (imdbId) {
    params.set('imdb_id', normalizeImdbId(imdbId));
    if (season != null) {
      params.set('season_number', String(season));
      params.set('episode_number', String(episode));
    }
  } else if (title) {
    params.set('query', title);
    params.set('episode_number', String(episode));
  } else {
    return { vtt: null, confirmed: false };
  }

  const search = await osFetch<OsSearchResponse>(`/subtitles?${params.toString()}`);
  if (search == null) return { vtt: null, confirmed: false }; // сам поиск не выполнился — не факт, что субтитра нет
  const candidates = search.data ?? [];
  if (candidates.length === 0) {
    console.log(`[opensubtitles] 0 кандидатов: ${params.toString()}`);
    return { vtt: null, confirmed: true }; // поиск реально прошёл — кандидатов действительно нет
  }

  const sorted = [...candidates].sort(
    (a, b) => b.attributes.download_count - a.attributes.download_count,
  );

  // imdb_id — это уже каталог конкретного тайтла (+ season/episode для
  // сериала), доверяем целиком, берём самый скачиваемый. Поиск по названию
  // (аниме) — доверия меньше, валидируем номер серии и схожесть названия.
  const best = imdbId
    ? sorted[0]?.attributes
    : sorted.find((c) => {
        const fd = c.attributes.feature_details;
        if (!fd) return false;
        if (fd.episode_number != null && fd.episode_number !== episode) return false;
        const candidateTitle = fd.parent_title || fd.title || '';
        return title ? titlesLikelyMatch(candidateTitle, title) : false;
      })?.attributes;

  const fileId = best?.files?.[0]?.file_id;
  if (!fileId) return { vtt: null, confirmed: true }; // кандидаты были, ни один не прошёл валидацию — честный промах

  const vtt = await downloadAsVtt(fileId);
  // Кандидат найден и провалидирован — если сам файл не скачался, это
  // техническая неудача (см. readBodyWithIdleTimeout), а не «субтитра нет».
  return { vtt, confirmed: vtt !== null };
}

interface CachedArgs {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  lang?: string;
  imdbId?: string | null;
  title?: string;
  /** Второе название для повторной попытки, если поиск по title ничего не
   *  дал (напр. русское название аниме, когда title — ромадзи/английское) —
   *  OpenSubtitles иногда каталогизирует один и тот же тайтл под локальным
   *  названием, которого нет в первом варианте. */
  altTitle?: string | null;
  /** Фильмы кино (season/episode тут всегда 1 просто по конвенции проекта,
   *  см. resolved_streams и т.д.) — у OpenSubtitles фильмы каталогизированы
   *  БЕЗ season/episode вообще, передать их означало бы отфильтровать
   *  реальные результаты. true — только для сериалов кино. */
  isSeries?: boolean;
}

/** Резолвит субтитр с кэшированием НАВСЕГДА в subtitle_cache (см. миграцию
 *  0012) — в отличие от resolved_streams видео-ссылок, тут кэш не протухает:
 *  текст субтитров серии не меняется, а бесплатная квота API дорога. */
export async function getCachedSubtitle({
  contentType,
  shikimoriId,
  season,
  episode,
  lang = 'ru',
  imdbId,
  title,
  altTitle,
  isSeries,
}: CachedArgs): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: cached } = await supabase
    .from('subtitle_cache')
    .select('vtt')
    .eq('content_type', contentType)
    .eq('shikimori_id', shikimoriId)
    .eq('season', season)
    .eq('episode', episode)
    .eq('lang', lang)
    .maybeSingle();

  if (cached) return cached.vtt;

  // Аниме — только по номеру серии (title-based поиск): у нашего "сезона"
  // (обычно 1, номера не user-facing) нет гарантированного соответствия
  // сезону в каталоге OpenSubtitles (абсолютная vs относительная нумерация
  // серий по кура́м). Кино — по season/episode только для сериалов.
  const searchSeason = contentType === 'cinema' && isSeries ? season : undefined;
  let result = await findSubtitle({ lang, episode, season: searchSeason, imdbId, title });

  // Вторая попытка по altTitle — только для title-based поиска (imdb_id уже
  // однозначно определяет тайтл, второе название тут не нужно и не поможет).
  if (!result.vtt && !imdbId && altTitle && altTitle !== title) {
    const second = await findSubtitle({ lang, episode, season: searchSeason, imdbId, title: altTitle });
    // confirmed навсегда — только если ОБЕ попытки честно не нашли: если
    // вторая не смогла выполниться технически, весь итог всё равно
    // неопределённый, даже если первая была confirmed.
    result = { vtt: second.vtt, confirmed: result.confirmed && second.confirmed };
  }

  // Кэшируем НАВСЕГДА только то, что реально знаем — либо нашли субтитр,
  // либо честно убедились, что его нет. Технический сбой (нет ключа, не
  // выполнился поиск, завис download — см. FindResult) кэшу не отдаём: он
  // останется незакэшированным и попробуется заново на следующий визит этой
  // же серии, вместо того чтобы навсегда прикинуться «искали, не нашли»
  // (воспроизведено вживую на «Пацаны»/S01E01 — зависший download.срт).
  if (result.vtt !== null || result.confirmed) {
    await supabase.from('subtitle_cache').upsert(
      { content_type: contentType, shikimori_id: shikimoriId, season, episode, lang, vtt: result.vtt },
      { onConflict: 'content_type,shikimori_id,season,episode,lang' },
    );
  }

  return result.vtt;
}
