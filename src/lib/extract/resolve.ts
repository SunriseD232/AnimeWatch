import { createServiceClient } from '@/lib/supabase/service';
import { getYummyEpisode } from '@/lib/video/yummy';
import { getKodikOwnPlayerTranslations } from '@/lib/video/kodik';
import { getVideoseedOwnPlayerTranslations } from '@/lib/videoseed-catalog';
import { getAllohaSources } from '@/lib/video/alloha';
import { resolveRealDebridStream } from '@/lib/video/realdebridResolve';
import { extractViaVps } from './vpsExtractor';
import type { ExtractSource, ResolvedStream } from './types';

/**
 * Апстрим-ссылки Alloha/Videoseed недолговечны (подписанные/токенизированные
 * URL) — поэтому кэшируем ненадолго, а не «навсегда». См. §12.6
 * ARCHITECTURE.md: извлечение теперь идёт через отдельный VPS-сервис
 * (vps-extractor/) — единственная конфигурация, подтверждённо проходящая
 * антибот источников; клиентское зеркало (mirror) не решило задачу и снято.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

interface Args {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  source: ExtractSource;
  /** Yummy video_id выбранной озвучки (только anime) — валиден только в
   *  рамках этой серии, см. §12 ARCHITECTURE.md / миграцию 0008. Не задано —
   *  для Alloha VPS сам перебирает кандидатов; для source, которым embedUrl
   *  обязателен (sibnet), извлечение без него вернёт null. */
  translationId?: number;
  /** Пропустить кэш и извлечь заново — для повтора после того, как
   *  закэшированная ссылка уже протухла у апстрима раньше своего TTL
   *  (видел на Videoseed: подписанные CDN-ссылки живут короче 15 минут). */
  forceFresh?: boolean;
  /** Сигнал отмены исходного запроса — прокидывается до extractViaVps, см.
   *  комментарий там. Кэш-хит игнорирует его (быстрый путь, отменять
   *  нечего), важен только на пути реального извлечения. */
  signal?: AbortSignal;
}

/**
 * Экстрактор на VPS сериализует Puppeteer-извлечения в одну очередь (см.
 * vps-extractor/src/server.js) — несколько НЕЗАВИСИМЫХ конкурентных вызовов
 * resolveStream на один и тот же {shikimoriId, episode, source, translationId}
 * (несколько параллельных запросов клиента, повторные тапы при видимом
 * зависании и т.п.) до того, как первый успел закэшироваться, раньше каждый
 * шёл в очередь отдельным полноценным Chromium-запуском — проверено вживую
 * 2026-08-21: очередь на VPS забилась десятками повторов одного и того же
 * эпизода подряд, из-за чего всё (включая несвязанные запросы) вставало в
 * очередь на минуты. Отдаём один и тот же in-flight promise всем конкурентным
 * вызовам с одинаковым ключом — как удачным (нашли в кэше), так и идущим в
 * реальное извлечение.
 *
 * joined — раньше здесь был только комментарий о намерении ("отменить может
 * только оригинальный вызов, пока не появились конкуренты"), без реального
 * применения: signal самого первого вызова передавался в extractViaVps как
 * есть, и его отмена (например, первый клиент ушёл со страницы) обрывала
 * ОБЩЕЕ извлечение для всех, кто успел коалесцироваться на этот же ключ,
 * хотя их собственные запросы не отменялись. Теперь извлечение всегда идёт
 * через свой internal AbortController: пока joined=false (мы всё ещё
 * единственный интересант), abort исходного signal пробрасывается в него как
 * раньше; как только кто-то коалесцировался (joined=true), дальнейшие abort
 * этого signal уже игнорируются — общая работа, которую уже ждут другие
 * вызовы, не отменяется.
 */
interface InFlight {
  promise: Promise<ResolvedStream | null>;
  joined: boolean;
}

const inFlightResolutions = new Map<string, InFlight>();

function resolutionKey(args: Args): string {
  const translationSlot = args.translationId ?? 0;
  return [
    args.contentType,
    args.shikimoriId,
    args.season,
    args.episode,
    args.source,
    translationSlot,
    args.forceFresh ? 'fresh' : 'cached',
  ].join(':');
}

export async function resolveStream(args: Args): Promise<ResolvedStream | null> {
  const key = resolutionKey(args);
  const existing = inFlightResolutions.get(key);
  if (existing) {
    existing.joined = true;
    return existing.promise;
  }

  const controller = new AbortController();
  const entry: InFlight = { joined: false, promise: Promise.resolve(null) };
  if (args.signal) {
    if (args.signal.aborted) {
      controller.abort();
    } else {
      args.signal.addEventListener('abort', () => {
        if (!entry.joined) controller.abort();
      });
    }
  }

  entry.promise = resolveStreamUncoalesced({ ...args, signal: controller.signal }).finally(() => {
    inFlightResolutions.delete(key);
  });
  inFlightResolutions.set(key, entry);
  return entry.promise;
}

async function resolveStreamUncoalesced({
  contentType,
  shikimoriId,
  season,
  episode,
  source,
  translationId,
  forceFresh,
  signal,
}: Args): Promise<ResolvedStream | null> {
  const supabase = createServiceClient();
  // 0 — слот "без явного выбора озвучки" (старое поведение, VPS сам перебирает).
  const translationSlot = translationId ?? 0;

  if (!forceFresh) {
    const { data: cached } = await supabase
      .from('resolved_streams')
      .select('url, headers, is_hls, is_dash, qualities, subtitles, expires_at')
      .eq('content_type', contentType)
      .eq('shikimori_id', shikimoriId)
      .eq('season', season)
      .eq('episode', episode)
      .eq('source', source)
      .eq('translation_id', translationSlot)
      .maybeSingle();

    if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
      return {
        url: cached.url,
        headers: (cached.headers as Record<string, string>) ?? {},
        isHls: cached.is_hls,
        isDash: cached.is_dash ?? undefined,
        qualities: (cached.qualities as ResolvedStream['qualities']) ?? undefined,
        subtitles: (cached.subtitles as ResolvedStream['subtitles']) ?? undefined,
      };
    }
  }

  // Конкретная озвучка запрошена — находим её embedUrl среди переводов той
  // же серии (тот же список, что уже показывался пользователю в селекторе
  // плеера — см. WatchPlayer/OwnPlayer). Источник списка разный: аниме —
  // Yummy, кино — Kodik/Videoseed по kinopoisk_id (у Yummy кино вообще нет).
  let embedUrl: string | undefined;
  // Только для videoseed: человекочитаемое имя выбранной озвучки — нужно
  // HTTP-пути извлечения (см. ExtractParams.translationLabel), чтобы
  // сопоставить её "{Label}" в конфиге плеера, а не только Puppeteer-пути,
  // который просто открывает embedUrl с default_audio_id как есть.
  let translationLabel: string | undefined;
  if (translationId != null) {
    if (contentType === 'anime') {
      const yummy = await getYummyEpisode(shikimoriId, episode);
      embedUrl = yummy?.translations.find((t) => t.id === translationId)?.embedUrl;
    } else if (source === 'kodik') {
      const kodik = await getKodikOwnPlayerTranslations(shikimoriId, season, episode);
      embedUrl = kodik.find((t) => t.id === translationId)?.embedUrl;
    } else if (source === 'videoseed') {
      const videoseed = await getVideoseedOwnPlayerTranslations(shikimoriId, season, episode);
      const translation = videoseed.find((t) => t.id === translationId);
      embedUrl = translation?.embedUrl;
      // title строится как `${short_name||name} · Videoseed` (см.
      // getVideoseedOwnPlayerTranslations) — отрезаем свой же суффикс, а не
      // парсим что-то стороннее, поэтому не хрупко.
      translationLabel = translation?.title.replace(/\s*·\s*Videoseed$/, '');
    } else if (source === 'alloha' && contentType === 'cinema') {
      const alloha = await getAllohaSources(shikimoriId);
      embedUrl = alloha.ownPlayerTranslations.find((t) => t.id === translationId)?.embedUrl;
    }
  }

  if (signal?.aborted) return null;
  // realdebrid не идёт через VPS-экстрактор (Puppeteer тут не нужен) — magnet
  // → прямая ссылка резолвится отдельной связкой Torrentio+Real-Debrid, см.
  // lib/video/realdebridResolve.ts. Результат кэшируется и проксируется тем
  // же общим путём ниже, что и любой другой источник.
  const resolved =
    source === 'realdebrid'
      ? await resolveRealDebridStream({ contentType, shikimoriId, season, episode })
      : await extractViaVps(source, { shikimoriId, season, episode, embedUrl, translationLabel }, signal);
  if (!resolved) return null;

  await supabase.from('resolved_streams').upsert(
    {
      content_type: contentType,
      shikimori_id: shikimoriId,
      season,
      episode,
      source,
      translation_id: translationSlot,
      url: resolved.url,
      headers: resolved.headers,
      is_hls: resolved.isHls,
      is_dash: resolved.isDash ?? false,
      qualities: resolved.qualities ?? null,
      subtitles: resolved.subtitles ?? null,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    },
    { onConflict: 'content_type,shikimori_id,season,episode,source,translation_id' },
  );

  return resolved;
}
