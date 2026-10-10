import { NextResponse, type NextRequest } from 'next/server';
import { resolveStream, findCrossSourceSubtitles, warmSubtitleSources } from '@/lib/extract/resolve';
import { fetchAndProxy, signRawUrl } from '@/lib/extract/proxy';
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
 * Три независимых источника субтитров, объединяются ПОЯЗЫЧНО (не
 * all-or-nothing, как раньше — это и была причина «где-то только русский,
 * где-то только английский»: если Videoseed отдавал хоть одну дорожку,
 * OpenSubtitles для недостающего языка вообще не спрашивали):
 *  1. Нативные субтитры ЗАПРОШЕННОГО источника+перевода — сейчас реально
 *     отдают Videoseed и Alloha (коды языка ISO 639-2, 'rus'/'eng', см.
 *     vps-extractor/src/{videoseed,alloha}.js) — используем resolveStream()
 *     (кэш-first, попадёт в уже тёплый кэш видео без повторного извлечения).
 *  2. Кросс-источниковые — если для какого-то языка родных субтитров нет
 *     у ЭТОГО перевода, но он уже есть в кэше resolved_streams у ДРУГОГО
 *     источника/перевода ТОЙ ЖЕ серии (см. findCrossSourceSubtitles в
 *     resolve.ts) — берём их. Синхронизация с чужим видеорядом НЕ
 *     гарантирована (разный монтаж/хронометраж у разных апстримов) —
 *     сознательно принятый риск: лучше не в идеальный такт, чем совсем без
 *     перевода. Чистое чтение кэша, ничего нового не извлекает.
 *  3. OpenSubtitles (см. lib/subtitles/opensubtitles.ts) — не привязан к
 *     видео-извлечению вообще, матчится по imdb_id (кино) или названию
 *     (аниме). Спрашиваем ТОЛЬКО про языки, не закрытые (1) и (2) — так и
 *     квота (100/сутки) не тратится впустую, и недостающий язык не остаётся
 *     без попытки.
 *
 * Если после всех трёх какой-то язык всё ещё не нашёлся — в фоне (БЕЗ
 * ожидания ответа клиенту, см. warmSubtitleSources) прогреваем кэш других
 * субтитро-способных источников на дефолтный перевод, чтобы СЛЕДУЮЩИЙ запрос
 * этой же ручки (повторный опрос плеера или другой пользователь той же
 * серии) уже нашёл их через (2), без своего собственного извлечения.
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

/**
 * Дорожка «только надписи» (forced): переводятся лишь вывески и титры, а не
 * речь. Videoseed отдаёт такие под обычной подписью «Русский» — проверено на
 * «Фонарях» (kp=5253825): 13 реплик на 57-минутную серию против 840 у
 * английской. Человек включал «Русский» и видел текст пару раз за серию —
 * отсюда жалоба «субтитры не работают» (2026-10-10). Хуже того, такая дорожка
 * засчитывалась как русский язык, и полноценные русские субтитры с
 * OpenSubtitles для серии даже не искали.
 *
 * Полные субтитры даже у 20-минутной серии — это сотни реплик, надписи —
 * единицы или пара десятков. Порог с запасом в обе стороны.
 */
const FORCED_MAX_CUES = 60;
/** Проверка дорожки — то же содержимое на ту же ссылку, поэтому помним
 *  ответ в памяти процесса: плеер спрашивает субтитры на каждую смену src. */
const forcedCache = new Map<string, boolean>();
const FORCED_CACHE_MAX = 2000;

async function isForcedOnly(url: string, headers: Record<string, string>): Promise<boolean> {
  const cached = forcedCache.get(url);
  if (cached !== undefined) return cached;
  let forced = false;
  try {
    const res = await Promise.race([
      fetchAndProxy(null, url, headers),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6_000)),
    ]);
    if (res.ok) {
      const text = await res.text();
      forced = (text.match(/-->/g)?.length ?? 0) < FORCED_MAX_CUES;
    } else {
      await res.body?.cancel().catch(() => {});
      // Не скачалась — не знаем; считаем полной, как раньше, и не запоминаем.
      return false;
    }
  } catch {
    return false;
  }
  if (forcedCache.size >= FORCED_CACHE_MAX) forcedCache.clear();
  forcedCache.set(url, forced);
  return forced;
}

/** Помечает дорожки «только надписи» в подписи и возвращает, какие из них
 *  такие, — их язык не считается закрытым (см. FORCED_MAX_CUES). */
async function markForced<T extends { lang: string; label: string; url: string }>(
  subs: T[],
  headersFor: (sub: T) => Record<string, string>,
): Promise<{ subs: T[]; forced: Set<T> }> {
  const forced = new Set<T>();
  const checked = await Promise.all(
    subs.map(async (sub) => {
      // Подпись уже говорит сама за себя (Alloha: «(Russian) Надписи»).
      if (/надпис|forced|signs/i.test(sub.label)) {
        forced.add(sub);
        return sub;
      }
      if (!NATIVE_LANG_TO_ISO2[sub.lang.toLowerCase()]) return sub;
      if (!(await isForcedOnly(sub.url, headersFor(sub)))) return sub;
      const marked = { ...sub, label: `${sub.label} (надписи)` };
      forced.add(marked);
      return marked;
    }),
  );
  return { subs: checked, forced };
}

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
  const translationTitle = request.nextUrl.searchParams.get('tl')?.slice(0, 200) || undefined;

  try {
    // Real-Debrid намеренно НЕ резолвим здесь — для него resolveStream
    // запускает полноценный подбор торрента (см. realdebridResolve.ts),
    // дорогую операцию с реальными сторонними запросами, которая тут не
    // нужна вообще: своих субтитров у Real-Debrid нет, только внешний
    // OpenSubtitles-фолбэк ниже, который на source никак не завязан.
    const resolved =
      source === 'realdebrid'
        ? null
        : await resolveStream({ contentType, shikimoriId, season, episode, source, translationId, translationTitle });

    // Реальный домен Videoseed наружу не отдаём — те же подписанные
    // /api/proxy/raw ссылки, что и для сегментов (см. lib/extract/proxy.ts).
    // Оставляем ВСЕ языки, что дал Videoseed (не только ru/en) — украинский,
    // например, лишним не будет.
    const nativeChecked = await markForced(resolved?.subtitles ?? [], () => resolved!.headers);
    const nativeSubs = nativeChecked.subs.map((s) => ({
      lang: s.lang,
      label: s.label,
      url: signRawUrl(s.url, resolved!.headers),
    }));
    const coveredIso2 = new Set(
      nativeChecked.subs
        .filter((s) => !nativeChecked.forced.has(s))
        .map((s) => NATIVE_LANG_TO_ISO2[s.lang.toLowerCase()])
        .filter((l): l is 'ru' | 'en' => l != null),
    );
    let missingLangs = TARGET_LANGS.filter((l) => !coveredIso2.has(l.lang));

    // Кросс-источниковые — уже тёплый кэш ДРУГОГО источника/перевода этой же
    // серии (см. findCrossSourceSubtitles в resolve.ts). Работает и для
    // Real-Debrid тоже (своих субтитров у него нет, но чужие ему не помеха) —
    // excludeSource=source тут просто не с чем совпасть, т.к. 'realdebrid' и
    // так не входит в SUBTITLE_CAPABLE_SOURCES. Синхронизация не
    // гарантирована — сознательно принятый риск, см. комментарий там же.
    const crossSourceRaw = await findCrossSourceSubtitles(
      { contentType, shikimoriId, season, episode },
      source,
      new Set(missingLangs.map((l) => l.lang)),
    ).catch(() => []);
    const crossChecked = await markForced(crossSourceRaw, (s) => s.headers);
    const crossSourceSubs = crossChecked.subs;
    const crossSourceIso2 = new Set(
      crossSourceSubs
        .filter((s) => !crossChecked.forced.has(s))
        .map((s) => NATIVE_LANG_TO_ISO2[s.lang.toLowerCase()])
        .filter((l): l is 'ru' | 'en' => l != null),
    );
    missingLangs = missingLangs.filter((l) => !crossSourceIso2.has(l.lang));

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

    // Всё ещё не хватает какого-то языка после всех трёх уровней — в фоне
    // (БЕЗ await, ответ клиенту не ждёт) прогреваем кэш других субтитро-
    // способных источников, чтобы следующий запрос этой же ручки уже нашёл
    // их через кросс-источниковый кэш выше.
    if (missingLangs.length > 0) {
      warmSubtitleSources({ contentType, shikimoriId, season, episode, excludeSource: source });
    }

    const crossSourceSignedSubs = crossSourceSubs.map((s) => ({
      lang: s.lang,
      label: s.label,
      url: signRawUrl(s.url, s.headers),
    }));

    const audioTracks = (resolved?.audioTracks ?? []).map((t) => ({ label: t.label }));

    return NextResponse.json({
      subtitles: [...nativeSubs, ...crossSourceSignedSubs, ...fallbackSubs],
      audioTracks,
    });
  } catch (err) {
    console.error('[proxy/subtitles] Упало:', err);
    return NextResponse.json({ subtitles: [], audioTracks: [] });
  }
}
