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
  if (!key) return null;
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
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
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

async function downloadAsVtt(fileId: number): Promise<string | null> {
  const data = await osFetch<{ link?: string }>('/download', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!data?.link) return null;
  try {
    const res = await fetch(data.link, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const srt = await res.text();
    return srtToVtt(srt);
  } catch {
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

/** Ищет и скачивает лучший субтитр под критерии — БЕЗ кэширования (кэш см.
 *  getCachedSubtitle ниже). null — не нашли или не прошло валидацию. */
async function findSubtitle({ lang, episode, season, imdbId, title }: FindArgs): Promise<string | null> {
  if (!apiKey()) return null;

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
    return null;
  }

  const search = await osFetch<OsSearchResponse>(`/subtitles?${params.toString()}`);
  const candidates = search?.data ?? [];
  if (candidates.length === 0) return null;

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
  if (!fileId) return null;

  return downloadAsVtt(fileId);
}

interface CachedArgs {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  lang?: string;
  imdbId?: string | null;
  title?: string;
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
  const vtt = await findSubtitle({ lang, episode, season: searchSeason, imdbId, title });

  await supabase.from('subtitle_cache').upsert(
    { content_type: contentType, shikimori_id: shikimoriId, season, episode, lang, vtt },
    { onConflict: 'content_type,shikimori_id,season,episode,lang' },
  );

  return vtt;
}
