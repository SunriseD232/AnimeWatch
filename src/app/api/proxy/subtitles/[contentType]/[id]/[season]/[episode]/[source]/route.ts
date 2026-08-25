import { NextResponse, type NextRequest } from 'next/server';
import { resolveStream } from '@/lib/extract/resolve';
import { signRawUrl } from '@/lib/extract/proxy';
import { getCachedSubtitle } from '@/lib/subtitles/opensubtitles';
import { getCinemaById } from '@/lib/videoseed-catalog';
import { getAnime } from '@/lib/shikimori';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * GET /api/proxy/subtitles/[contentType]/[id]/[season]/[episode]/[source]
 *
 * Отдельная лёгкая ручка (не встроена в основной /api/proxy/.../[source]):
 * субтитры — не часть m3u8/mp4-потока, а самостоятельные .vtt-файлы.
 * OwnPlayer запрашивает их отдельно и добавляет <track> в <video>.
 *
 * Два независимых источника субтитров:
 *  1. Videoseed отдаёт реальные .vtt при извлечении видео (см.
 *     vps-extractor/src/videoseed.js) — используем resolveStream() (кэш-
 *     first, попадёт в уже тёплый кэш видео без повторного извлечения).
 *  2. OpenSubtitles (см. lib/subtitles/opensubtitles.ts) — не привязан к
 *     видео-извлечению вообще, матчится по imdb_id (кино) или названию
 *     (аниме). Проверяем ТОЛЬКО если (1) ничего не дал — иначе на каждый
 *     визит тратили бы небольшую (100/сутки) квоту API впустую.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed', 'sibnet', 'kodik', 'cvh', 'aksor']);

interface RouteParams {
  contentType: string;
  id: string;
  season: string;
  episode: string;
  source: string;
}

/** Данные-VTT прямо в URL — избегает отдельного роута/подписи: контент уже
 *  полностью зарезолвлен на сервере (и закэширован в subtitle_cache), а
 *  <track src> прекрасно принимает data: URL. */
function vttDataUrl(vtt: string): string {
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

export async function GET(request: NextRequest, { params }: { params: RouteParams }) {
  const contentType: 'anime' | 'cinema' = params.contentType === 'cinema' ? 'cinema' : 'anime';
  const shikimoriId = Number(params.id);
  const season = Number(params.season) || 1;
  const episode = Number(params.episode);
  const source = params.source as ExtractSource;

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode) || !ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ subtitles: [] });
  }

  const tRaw = request.nextUrl.searchParams.get('t');
  const translationId = tRaw != null && Number.isFinite(Number(tRaw)) ? Number(tRaw) : undefined;

  try {
    const resolved = await resolveStream({ contentType, shikimoriId, season, episode, source, translationId });
    if (resolved?.subtitles?.length) {
      // Реальный домен Videoseed наружу не отдаём — те же подписанные
      // /api/proxy/raw ссылки, что и для сегментов (см. lib/extract/proxy.ts).
      const subtitles = resolved.subtitles.map((s) => ({
        lang: s.lang,
        label: s.label,
        url: signRawUrl(s.url, resolved.headers),
      }));
      return NextResponse.json({ subtitles });
    }

    // ru + en параллельно — subtitle_cache кэширует НАВСЕГДА (в т.ч. промахи,
    // см. getCachedSubtitle), так что квота OpenSubtitles (100/сутки) тратится
    // на добавление en только один раз на серию, а не на каждый визит.
    const LANGS: { lang: 'ru' | 'en'; label: string }[] = [
      { lang: 'ru', label: 'Русский' },
      { lang: 'en', label: 'English' },
    ];
    let vttByLang: (string | null)[];
    if (contentType === 'cinema') {
      const item = await getCinemaById(shikimoriId);
      vttByLang = item?.idImdb
        ? await Promise.all(
            LANGS.map(({ lang }) =>
              getCachedSubtitle({
                contentType,
                shikimoriId,
                season,
                episode,
                lang,
                imdbId: item.idImdb!,
                isSeries: item.isSerial,
              }),
            ),
          )
        : LANGS.map(() => null);
    } else {
      const anime = await getAnime(shikimoriId).catch(() => null);
      vttByLang = anime?.name
        ? await Promise.all(
            LANGS.map(({ lang }) => getCachedSubtitle({ contentType, shikimoriId, season, episode, lang, title: anime.name })),
          )
        : LANGS.map(() => null);
    }

    const subtitles = LANGS.map(({ lang, label }, i) => {
      const vtt = vttByLang[i];
      return vtt ? { lang, label, url: vttDataUrl(vtt) } : null;
    }).filter((s): s is { lang: 'ru' | 'en'; label: string; url: string } => s !== null);

    return NextResponse.json({ subtitles });
  } catch (err) {
    console.error('[proxy/subtitles] Упало:', err);
    return NextResponse.json({ subtitles: [] });
  }
}
