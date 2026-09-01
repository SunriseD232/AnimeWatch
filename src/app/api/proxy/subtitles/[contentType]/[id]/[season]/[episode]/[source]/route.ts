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
 * Два независимых источника субтитров, объединяются ПОЭЗЫЧНО (не
 * all-or-nothing, как раньше — это и была причина «где-то только русский,
 * где-то только английский»: если Videoseed отдавал хоть одну дорожку,
 * OpenSubtitles для недостающего языка вообще не спрашивали):
 *  1. Videoseed отдаёт реальные .vtt при извлечении видео (см.
 *     vps-extractor/src/videoseed.js, коды языка там ISO 639-2, 'rus'/'eng')
 *     — используем resolveStream() (кэш-first, попадёт в уже тёплый кэш
 *     видео без повторного извлечения).
 *  2. OpenSubtitles (см. lib/subtitles/opensubtitles.ts) — не привязан к
 *     видео-извлечению вообще, матчится по imdb_id (кино) или названию
 *     (аниме). Спрашиваем ТОЛЬКО про языки, которых нет среди (1) — так и
 *     квота (100/сутки) не тратится впустую на уже закрытый Videoseed язык,
 *     и недостающий не остаётся без попытки.
 *
 * Заодно (не по чистоте имени ручки, а по экономии round-trip'а — resolved
 * уже под рукой) отдаём audioTracks: список ДОП. аудиодорожек (см.
 * ResolvedStream.audioTracks — сейчас только у Alloha, напр. оригинал без
 * перевода). Только label — сырые URL клиенту не нужны, переключение идёт
 * через query-параметр ?audio=<индекс> на самом /api/proxy/.../[source]
 * (см. его pickAudioTrackUrl), сервер сам подставляет нужный.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<ExtractSource>([
  'alloha',
  'videoseed',
  'sibnet',
  'kodik',
  'cvh',
  'aksor',
  'realdebrid',
]);

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

/** Коды языка у Videoseed — ISO 639-2 (3 буквы, см. vps-extractor/src/
 *  videoseed.js), у OpenSubtitles-фолбэка — ISO 639-1 (2 буквы, 'ru'/'en').
 *  Нужно, чтобы понять, какой из двух целевых языков Videoseed уже закрыл,
 *  не запрашивая его повторно у OpenSubtitles. */
const NATIVE_LANG_TO_ISO2: Record<string, 'ru' | 'en'> = {
  rus: 'ru',
  ru: 'ru',
  eng: 'en',
  en: 'en',
};

const TARGET_LANGS: { lang: 'ru' | 'en'; label: string }[] = [
  { lang: 'ru', label: 'Русский' },
  { lang: 'en', label: 'English' },
];

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
    // Real-Debrid намеренно НЕ резолвим здесь — для него resolveStream
    // запускает полноценный подбор торрента (см. realdebridResolve.ts),
    // дорогую операцию с реальными сторонними запросами, которая тут не
    // нужна вообще: своих субтитров у Real-Debrid нет, только внешний
    // OpenSubtitles-фолбэк ниже, который на source никак не завязан.
    const resolved =
      source === 'realdebrid'
        ? null
        : await resolveStream({ contentType, shikimoriId, season, episode, source, translationId });

    // Реальный домен Videoseed наружу не отдаём — те же подписанные
    // /api/proxy/raw ссылки, что и для сегментов (см. lib/extract/proxy.ts).
    // Оставляем ВСЕ языки, что дал Videoseed (не только ru/en) — украинский,
    // например, лишним не будет.
    const nativeSubs = (resolved?.subtitles ?? []).map((s) => ({
      lang: s.lang,
      label: s.label,
      url: signRawUrl(s.url, resolved!.headers),
    }));
    const coveredIso2 = new Set(
      nativeSubs
        .map((s) => NATIVE_LANG_TO_ISO2[s.lang.toLowerCase()])
        .filter((l): l is 'ru' | 'en' => l != null),
    );
    const missingLangs = TARGET_LANGS.filter((l) => !coveredIso2.has(l.lang));

    // Спрашиваем OpenSubtitles только про недостающие языки — subtitle_cache
    // кэширует НАВСЕГДА (в т.ч. промахи, см. getCachedSubtitle), так что
    // квота (100/сутки) тратится на конкретную серию+язык максимум один раз.
    let fallbackSubs: { lang: 'ru' | 'en'; label: string; url: string }[] = [];
    if (missingLangs.length > 0) {
      let vttByLang: (string | null)[];
      if (contentType === 'cinema') {
        const item = await getCinemaById(shikimoriId);
        vttByLang = item
          ? await Promise.all(
              missingLangs.map(({ lang }) =>
                getCachedSubtitle(
                  item.idImdb
                    ? {
                        contentType,
                        shikimoriId,
                        season,
                        episode,
                        lang,
                        imdbId: item.idImdb,
                        isSeries: item.isSerial,
                      }
                    : // Нет imdb_id (бывает у части каталога Videoseed) — не
                      // просто отказываемся от субтитров, ищем хотя бы по
                      // названию, как для аниме (менее точно, но лучше, чем
                      // ничего — findSubtitle всё равно валидирует номер
                      // серии/схожесть названия перед тем, как отдать файл).
                      { contentType, shikimoriId, season, episode, lang, title: item.title },
                ),
              ),
            )
          : missingLangs.map(() => null);
      } else {
        const anime = await getAnime(shikimoriId).catch(() => null);
        vttByLang = anime?.name
          ? await Promise.all(
              missingLangs.map(({ lang }) =>
                getCachedSubtitle({
                  contentType,
                  shikimoriId,
                  season,
                  episode,
                  lang,
                  title: anime.name,
                  // Второй заход по русскому названию — OpenSubtitles иногда
                  // каталогизирует аниме под локальным, а не ромадзи-именем
                  // (см. altTitle в getCachedSubtitle).
                  altTitle: anime.russian || null,
                }),
              ),
            )
          : missingLangs.map(() => null);
      }

      fallbackSubs = missingLangs
        .map(({ lang, label }, i) => {
          const vtt = vttByLang[i];
          return vtt ? { lang, label, url: vttDataUrl(vtt) } : null;
        })
        .filter((s): s is { lang: 'ru' | 'en'; label: string; url: string } => s !== null);
    }

    const audioTracks = (resolved?.audioTracks ?? []).map((t) => ({ label: t.label }));

    return NextResponse.json({ subtitles: [...nativeSubs, ...fallbackSubs], audioTracks });
  } catch (err) {
    console.error('[proxy/subtitles] Упало:', err);
    return NextResponse.json({ subtitles: [], audioTracks: [] });
  }
}
