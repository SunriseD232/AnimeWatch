'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import AnimeCard from '@/components/AnimeCard';
import HlsPlayer from '@/components/HlsPlayer';
import KodikPlayer from '@/components/KodikPlayer';
import YummyPlayer from '@/components/YummyPlayer';
import {
  episodeQualities,
  getRelease,
  pickEpisode,
  resolveReleaseId,
  type HlsQuality,
} from '@/lib/anilibria';
import type { Translation } from '@/lib/video/types';
import type { YummyTranslation } from '@/lib/video/yummy';
import type { ShikimoriAnimeShort } from '@/lib/shikimori';
import type { ContentType, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { usePipPlayerHost } from '@/components/pip/PipPlayerHost';

interface SkipSegment {
  time: number;
  length: number;
}

interface Props {
  shikimoriId: number;
  contentType: ContentType;
  episode: number;
  total: number;
  animeTitle: string;
  posterUrl: string | null;
  animeRomaji: string;
  animeRussian: string;
  animeYear: number | null;
  resumeFrom: number | null;
  otherEpisode: number | null;
  isAuthed: boolean;
  /** Онгоинг Shikimori — вышли не все серии, рано переводить в «Просмотрено». */
  isOngoing: boolean;
  // Данные Kodik (fallback), подготовленные на сервере.
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
  // Данные Yummy (резервный источник) и тайминги пропуска для AniLibria.
  yummyTranslations: YummyTranslation[];
  /** Сохранённая озвучка (по названию — см. миграцию 0008) для OwnPlayer. */
  savedTranslationTitle: string | null;
  skipOpening: SkipSegment | null;
  skipEnding: SkipSegment | null;
  // Подсказки под плеером: прямое продолжение франшизы и похожие тайтлы.
  prequels: ShikimoriAnimeShort[];
  sequels: ShikimoriAnimeShort[];
  similar: ShikimoriAnimeShort[];
}

type Source = 'hls' | 'kodik' | 'yummy' | 'own';

const PREF_KEY = 'aw:preferredSource';
/** Задержка автоперехода на следующую серию после окончания текущей. */
const AUTO_NEXT_DELAY_MS = 3_000;
/** Прогрев «Наш плеер» следующей серии — насколько раньше конца текущей
 *  (титры/аутро пользователь часто пропускает сам, не дожидаясь конца). */
const PREWARM_WINDOW_S = 300;
const PREWARM_POLL_MS = 15_000;

/** Ответ /api/watch/anime/[shikimoriId]/[episode] — см. switchEpisode. */
interface EpisodeSourcesResponse {
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
  episodesTotal: number | null;
  yummyTranslations: YummyTranslation[];
  skipOpening: SkipSegment | null;
  skipEnding: SkipSegment | null;
  resumeFrom: number | null;
}

/**
 * Оркестратор просмотра: пытается воспроизвести тайтл через AniLibria (1080p,
 * свой hls-плеер), а если его там нет — откатывается на Kodik (iframe).
 * Держит общий каркас страницы (навигация, баннеры) и realtime-синхронизацию.
 */
export default function WatchPlayer({
  shikimoriId,
  contentType,
  episode,
  total,
  animeTitle,
  posterUrl,
  animeRomaji,
  animeRussian,
  animeYear,
  resumeFrom: initialResumeFrom,
  otherEpisode,
  isAuthed,
  isOngoing,
  kodikEmbedUrl: initialKodikEmbedUrl,
  kodikTranslations: initialKodikTranslations,
  kodikInitialTranslationId: initialKodikInitialTranslationId,
  kodikFallback: initialKodikFallback,
  yummyTranslations: initialYummyTranslations,
  savedTranslationTitle,
  skipOpening: initialSkipOpening,
  skipEnding: initialSkipEnding,
  prequels,
  sequels,
  similar,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const pipHost = usePipPlayerHost();

  const [resolving, setResolving] = useState(true);
  // null = AniLibria недоступна для этого тайтла/серии.
  const [aniQualities, setAniQualities] = useState<HlsQuality[] | null>(null);
  const [source, setSource] = useState<Source>('kodik');
  const [kodikEmbed, setKodikEmbed] = useState(initialKodikEmbedUrl);
  // Источники серии — локальное состояние поверх начальных пропов: при
  // бесшовном переключении (см. switchEpisode) обновляются из ответа
  // /api/watch/anime/..., а не через полную навигацию/перерендер страницы.
  const [kodikTranslations, setKodikTranslations] = useState(initialKodikTranslations);
  const [kodikInitialTranslationId, setKodikInitialTranslationId] = useState(
    initialKodikInitialTranslationId,
  );
  const [kodikFallback, setKodikFallback] = useState(initialKodikFallback);
  const [yummyTranslations, setYummyTranslations] = useState(initialYummyTranslations);
  const [skipOpening, setSkipOpening] = useState(initialSkipOpening);
  const [skipEnding, setSkipEnding] = useState(initialSkipEnding);
  const [resumeFrom, setResumeFrom] = useState(initialResumeFrom);
  // Переключение ИСТОЧНИКА (вкладки плеера) — существующее; switchingEpisode
  // ниже — новое, переключение СЕРИИ.
  const [switching, setSwitching] = useState(false);
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const [ended, setEnded] = useState(false);
  // Автопереход на следующую серию (null — неактивен/отменён).
  const [autoNext, setAutoNext] = useState<number | null>(null);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showOtherBanner, setShowOtherBanner] = useState(otherEpisode !== null);
  // Активная серия: может измениться из самого плеера Kodik.
  const [activeEpisode, setActiveEpisode] = useState(episode);
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  // Прогрели ли уже следующую серию «Наш плеер» — сброс на каждую новую
  // активную серию (см. эффект прогрева ниже).
  const prewarmedRef = useRef(false);
  // Контейнер, в который PipPlayerHost порталит реальный OwnPlayer (см.
  // эффект show/hide ниже и components/pip/PipPlayerHost.tsx).
  const ownPlayerDockRef = useRef<HTMLDivElement | null>(null);

  // Синхронизируем активную серию, когда сменился маршрут (прямые ссылки,
  // обновление страницы — не бесшовное переключение, см. switchEpisode).
  useEffect(() => {
    setActiveEpisode(episode);
  }, [episode]);

  // При навигации по маршруту сервер отдаёт новый Kodik-embed — обновляем iframe.
  useEffect(() => {
    setKodikEmbed(initialKodikEmbedUrl);
  }, [initialKodikEmbedUrl]);

  const isCinema = contentType === 'cinema';
  const watchBase = isCinema ? '/cinema/watch' : '/watch';
  const detailHref = `${isCinema ? '/cinema' : '/anime'}/${shikimoriId}`;
  const hasYummy = yummyTranslations.length > 0;
  // OwnPlayer проксирует байты только для переводов, для которых есть
  // извлечение на VPS (source != null, см. lib/video/yummy.ts detectSource) —
  // остальные балансеры Yummy (Kodik/CVH/Aksor/...) пока доступны только
  // через iframe-плеер Yummy (вкладка «Yummy»).
  const ownPlayerTranslations = yummyTranslations.filter((t) => t.source != null);
  const hasOwnPlayer = ownPlayerTranslations.length > 0;

  const playingRef = useRef(false);
  // Актуальная позиция активного плеера — для переноса при смене источника.
  const livePositionRef = useRef<number>(resumeFrom ?? 0);
  const bumpPosition = useCallback((t: number) => {
    if (Number.isFinite(t) && t > 0) livePositionRef.current = t;
  }, []);
  // Длительность — заполняется только OwnPlayer.onTimeUpdate (единственный
  // источник, где реальная длительность файла заранее неизвестна) — нужна
  // прогреву «Наш плеер» ниже (durationRef - livePositionRef <= окно).
  const durationRef = useRef<number | null>(null);

  const hasNext = activeEpisode < total;
  const hasPrev = activeEpisode > 1;

  // --- Подбор источника: AniLibria → иначе Kodik (только для аниме) ---
  // Завязано на activeEpisode (не на проп episode) — иначе при бесшовном
  // переключении (см. switchEpisode) AniLibria не переразрешалась бы для
  // новой серии.
  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setAniQualities(null);
    (async () => {
      let q: HlsQuality[] | null = null;
      if (!isCinema) {
        try {
          const id = await resolveReleaseId({
            romaji: animeRomaji,
            russian: animeRussian,
            year: animeYear,
          });
          if (!cancelled && id != null) {
            const rel = await getRelease(id);
            if (!cancelled && rel && !rel.is_blocked_by_geo) {
              const ep = pickEpisode(rel, activeEpisode);
              const eq = ep ? episodeQualities(ep) : [];
              if (eq.length > 0) q = eq;
            }
          }
        } catch {
          /* оставим q = null → Kodik */
        }
      }
      if (cancelled) return;
      setAniQualities(q);
      // Учитываем сохранённое предпочтение пользователя — но только если
      // этот источник реально доступен для данной серии.
      const pref = (
        typeof window !== 'undefined'
          ? window.localStorage.getItem(PREF_KEY)
          : null
      ) as Source | null;
      const available: Source[] = [
        ...(q ? (['hls'] as const) : []),
        'kodik',
        ...(hasYummy ? (['yummy'] as const) : []),
        ...(hasOwnPlayer ? (['own'] as const) : []),
      ];
      const fallback: Source = q ? 'hls' : 'kodik';
      setSource(pref && available.includes(pref) ? pref : fallback);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isCinema, animeRomaji, animeRussian, animeYear, activeEpisode, hasYummy, hasOwnPlayer]);

  // --- Ручное переключение источника с переносом позиции ---
  const switchTo = useCallback(
    async (target: Source) => {
      if (target === source || switching) return;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PREF_KEY, target);
      }
      const pos = Math.floor(livePositionRef.current);
      // Для Kodik стартовую позицию надо зашить в embed-URL заново.
      if (target === 'kodik' && pos > 5) {
        setSwitching(true);
        try {
          const params = new URLSearchParams({
            shikimoriId: String(shikimoriId),
            episode: String(activeEpisode),
            startFrom: String(pos),
          });
          if (kodikInitialTranslationId) {
            params.set('translationId', String(kodikInitialTranslationId));
          }
          const res = await fetch(`/api/kodik?${params.toString()}`);
          if (res.ok) {
            const data = (await res.json()) as { embedUrl?: string };
            if (data.embedUrl) setKodikEmbed(data.embedUrl);
          }
        } catch {
          /* оставим текущий embed */
        }
        setSwitching(false);
      }
      setSource(target);
    },
    [source, switching, shikimoriId, activeEpisode, kodikInitialTranslationId],
  );

  // --- Тост о восстановленной позиции ---
  useEffect(() => {
    if (resumeFrom && resumeFrom > 5) {
      toast(`Вы остановились на ${formatTime(resumeFrom)}`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Окончание серии: пометки, автопереход ---
  const onEnded = useCallback(() => {
    setEnded(true);
    const finishedEpisode = activeEpisode;
    const nextEpisode = hasNext ? finishedEpisode + 1 : null;

    if (isAuthed) {
      // Серия досмотрена; тайтл — в «Просмотрено», только если это
      // действительно последняя серия ЦЕЛИКОМ (а не просто последняя из
      // ВЫШЕДШИХ у онгоинга — там дальше ещё будут серии, рано закрывать).
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          season: 1,
          episode: finishedEpisode,
          watched_episode: true,
          completed: nextEpisode === null && !isOngoing,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    if (isAuthed && nextEpisode !== null) {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          episode: nextEpisode,
          position_seconds: 5,
          duration_seconds: null,
          translation_id: null,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    // Автопереход с возможностью отмены в плашке.
    if (nextEpisode !== null) {
      setAutoNext(nextEpisode);
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = setTimeout(() => {
        switchEpisodeRef.current(nextEpisode);
      }, AUTO_NEXT_DELAY_MS);
    }
  }, [
    isAuthed,
    hasNext,
    isOngoing,
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
    activeEpisode,
  ]);

  // Отмена автоперехода.
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNext(null);
  }, []);

  // Сброс автоперехода при смене серии/размонтировании.
  useEffect(() => {
    setAutoNext(null);
    setEnded(false);
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
  }, [episode]);

  // --- Смена серии внутри плеера Kodik → обновляем номер/навигацию ---
  const onEpisodeChange = useCallback((ep: number) => {
    setActiveEpisode(ep);
    setEnded(false);
  }, []);

  // --- Realtime между устройствами (last-write-wins) ---
  // Подписка держится СТАБИЛЬНОЙ через бесшовные переключения серии (episode
  // не в deps ниже) — сравнение идёт по свежему activeEpisodeRef, а не по
  // пропу episode (который не меняется при switchEpisode).
  useEffect(() => {
    if (!isAuthed) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`wp-${shikimoriId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'watch_progress' },
        (payload) => {
          const row = payload.new as WatchProgress | undefined;
          if (!row || row.shikimori_id !== shikimoriId) return;
          const isBackground =
            document.visibilityState === 'hidden' || !playingRef.current;
          if (isBackground && row.episode !== activeEpisodeRef.current) {
            toast(
              `На другом устройстве вы перешли на серию ${row.episode}`,
              'info',
            );
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthed, shikimoriId, toast]);

  // --- Бесшовное переключение серии ---------------------------------------
  // Вместо полной Next-навигации: оптимистично обновляем номер серии, тянем
  // ТОЛЬКО нужные для новой серии источники с /api/watch/anime/... (без
  // тайтл-уровневых данных — постер/предиквелы/сиквелы/похожее не
  // перезапрашиваются), обновляем адресную строку через history.pushState
  // (без полного роутинга Next). AniLibria переразрешается сама (см. эффект
  // выше, завязан на activeEpisode). При сбое — настоящая навигация, чтобы
  // пользователь не застрял. Флаш прогресса СТАРОЙ серии — на существующих
  // триггерах source-компонентов (пауза/интервал/скрытие вкладки, см.
  // useProgressSaver) — здесь его дополнительно не форсируем: как и при
  // обычной клиентской навигации Next.js, это best-effort с окном в
  // несколько секунд, не хуже текущего поведения.
  const switchEpisode = useCallback(
    async (targetEpisode: number, pushHistory = true) => {
      setSwitchingEpisode(true);
      setShowOtherBanner(false);
      setEnded(false);
      setAutoNext(null);
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }
      setActiveEpisode(targetEpisode);
      livePositionRef.current = 0;
      durationRef.current = null;
      prewarmedRef.current = false;

      try {
        const params = new URLSearchParams();
        if (kodikInitialTranslationId != null) {
          params.set('translationId', String(kodikInitialTranslationId));
        }
        const qs = params.toString();
        const res = await fetch(
          `/api/watch/anime/${shikimoriId}/${targetEpisode}${qs ? `?${qs}` : ''}`,
        );
        if (!res.ok) throw new Error('bad response');
        const data = (await res.json()) as EpisodeSourcesResponse;

        setKodikEmbed(data.kodikEmbedUrl);
        setKodikTranslations(data.kodikTranslations);
        setKodikInitialTranslationId(data.kodikInitialTranslationId);
        setKodikFallback(data.kodikFallback);
        setYummyTranslations(data.yummyTranslations);
        setSkipOpening(data.skipOpening);
        setSkipEnding(data.skipEnding);
        setResumeFrom(data.resumeFrom);

        if (pushHistory) {
          window.history.pushState(null, '', `${watchBase}/${shikimoriId}/${targetEpisode}`);
        }
        document.title = `${animeTitle} — MediaWatch`;
      } catch {
        toast('Не удалось переключить серию, открываю страницу заново', 'error');
        router.push(`${watchBase}/${shikimoriId}/${targetEpisode}`);
      } finally {
        setSwitchingEpisode(false);
      }
    },
    [shikimoriId, kodikInitialTranslationId, watchBase, animeTitle, toast, router],
  );
  // Всегда-свежая ссылка на switchEpisode — для замыканий, живущих дольше её
  // собственной идентичности (автопереход в onEnded, объявленный выше).
  const switchEpisodeRef = useRef(switchEpisode);
  switchEpisodeRef.current = switchEpisode;

  // Кнопка «Назад»/«Вперёд» браузера — история двигалась через pushState в
  // switchEpisode, без участия роутера Next, поэтому ловим её сами.
  useEffect(() => {
    const titleBase = `${watchBase}/${shikimoriId}/`;
    const onPopState = () => {
      const path = window.location.pathname;
      if (!path.startsWith(titleBase)) return; // ушли с этого тайтла вовсе
      const parts = path.split('/').filter(Boolean);
      const e = Number(parts[parts.length - 1]);
      if (Number.isFinite(e) && e !== activeEpisodeRef.current) {
        switchEpisode(e, false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [switchEpisode, watchBase, shikimoriId]);

  // --- Прогрев «Наш плеер» следующей серии --------------------------------
  // За 5 минут до конца текущей — см. тот же приём и обоснование окна в
  // Player.tsx (cinema). durationRef тут заполняется только из OwnPlayer
  // (единственный источник, где длительность заранее неизвестна). Два шага:
  // лёгкий /api/watch/anime/... за озвучками Yummy следующей серии, затем
  // HEAD на /api/proxy/.../{source}?t=<id> для первой из них — тот роут
  // реально вызывает resolveStream() и кладёт результат в кэш.
  useEffect(() => {
    if (source !== 'own' || !hasOwnPlayer) return;
    const id = setInterval(() => {
      if (prewarmedRef.current) return;
      const dur = durationRef.current;
      if (!dur || dur - livePositionRef.current > PREWARM_WINDOW_S) return;
      const nextEp = activeEpisodeRef.current + 1;
      if (nextEp > total) return;
      prewarmedRef.current = true;
      const params = new URLSearchParams();
      if (kodikInitialTranslationId != null) {
        params.set('translationId', String(kodikInitialTranslationId));
      }
      const qs = params.toString();
      fetch(`/api/watch/anime/${shikimoriId}/${nextEp}${qs ? `?${qs}` : ''}`)
        .then((r) => (r.ok ? (r.json() as Promise<EpisodeSourcesResponse>) : null))
        .then((data) => {
          const t = data?.yummyTranslations.find((tr) => tr.source != null);
          if (!t?.source) return;
          return fetch(
            `/api/proxy/anime/${shikimoriId}/1/${nextEp}/${t.source}?t=${t.id}`,
            { method: 'HEAD' },
          );
        })
        .catch(() => {});
    }, PREWARM_POLL_MS);
    return () => clearInterval(id);
  }, [source, hasOwnPlayer, shikimoriId, total, kodikInitialTranslationId]);

  // --- Держим OwnPlayer в PipPlayerHost в курсе актуальных пропсов -------
  // Реальный <video>/hls.js живёт не здесь (см. PipPlayerHost) — чтобы
  // пережить уход со страницы при активном Picture-in-Picture. Пока вкладка
  // «Наш плеер» открыта на этой странице — просим держатель рисовать его в
  // наш dock со свежими пропсами на каждом рендере (без списка зависимостей:
  // как обычный проброс пропсов, только через один хоп).
  const ownPlayerTitleKey = `${contentType}:${shikimoriId}`;
  useEffect(() => {
    if (source !== 'own' || !hasOwnPlayer || !ownPlayerDockRef.current) {
      pipHost.hide(ownPlayerTitleKey);
      return;
    }
    pipHost.show(
      ownPlayerTitleKey,
      {
        contentType,
        shikimoriId,
        season: 1,
        episode: activeEpisode,
        extractSource: 'alloha',
        animeTitle,
        posterUrl,
        isAuthed,
        resumeFrom:
          livePositionRef.current > 1
            ? Math.floor(livePositionRef.current)
            : resumeFrom,
        translations: ownPlayerTranslations,
        initialTranslationTitle: savedTranslationTitle,
        skipOpening,
        skipEnding,
        nextHref: hasNext ? `${watchBase}/${shikimoriId}/${activeEpisode + 1}` : null,
        onNext: hasNext ? () => switchEpisode(activeEpisode + 1) : undefined,
        onEnded,
        onTimeUpdate: (t, d) => {
          bumpPosition(t);
          if (d) durationRef.current = d;
        },
      },
      ownPlayerDockRef.current,
    );
  });

  // Настоящее размонтирование страницы (не путать с обычным ре-рендером
  // выше) — если PiP не активен, PipPlayerHost закроет сессию; если активен,
  // оставит <video> жить в своём скрытом контейнере (см. PipPlayerHost.hide).
  useEffect(() => {
    return () => pipHost.hide(ownPlayerTitleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок */}
      <div className="min-w-0">
        <Link
          href={detailHref}
          className="line-clamp-1 text-lg font-bold hover:text-accent"
        >
          {animeTitle}
        </Link>
        <p className="text-sm text-gray-400">
          Серия {activeEpisode}
          {total > 1 ? ` из ${total}` : ''}
        </p>
      </div>

      {/* Баннер про другую серию */}
      {showOtherBanner && otherEpisode !== null && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/10 px-4 py-3 text-sm">
          <span>Вы остановились на серии {otherEpisode}.</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => switchEpisode(otherEpisode)}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              Перейти
            </button>
            <button
              type="button"
              onClick={() => setShowOtherBanner(false)}
              className="text-gray-400 hover:text-white"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Переключатель источника — когда есть альтернатива Kodik */}
      {!resolving && (aniQualities || hasYummy) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-gray-400">Плеер:</span>
          {/* overflow-x-auto + whitespace-nowrap — до 4 вкладок (включая
              длинную «AniLibria · 720p») не влезают в строку на мобильном
              без этого, подписи переносились внутри своих же пилюль. */}
          <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-bg-card p-0.5 ring-1 ring-white/5">
            {aniQualities && (
              <button
                type="button"
                onClick={() => switchTo('hls')}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
                  source === 'hls'
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:text-white',
                ].join(' ')}
              >
                AniLibria · {aniQualities[0]?.label ?? '720'}p
              </button>
            )}
            <button
              type="button"
              onClick={() => switchTo('kodik')}
              className={[
                'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
                source === 'kodik'
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              Kodik
            </button>
            {hasYummy && (
              <button
                type="button"
                onClick={() => switchTo('yummy')}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
                  source === 'yummy'
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:text-white',
                ].join(' ')}
              >
                Yummy
              </button>
            )}
            {hasOwnPlayer && (
              <button
                type="button"
                onClick={() => switchTo('own')}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
                  source === 'own'
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:text-white',
                ].join(' ')}
              >
                Наш плеер
              </button>
            )}
          </div>
          {(switching || switchingEpisode) && (
            <span className="text-xs text-gray-400">
              {switchingEpisode ? 'переключаем серию…' : 'переключаем…'}
            </span>
          )}
        </div>
      )}

      {/* Медиа */}
      {resolving ? (
        <div className="skeleton flex aspect-video w-full items-center justify-center">
          <span className="text-sm text-gray-400">Подбираем источник…</span>
        </div>
      ) : source === 'hls' && aniQualities ? (
        <HlsPlayer
          shikimoriId={shikimoriId}
          episode={activeEpisode}
          animeTitle={animeTitle}
          posterUrl={posterUrl}
          isAuthed={isAuthed}
          qualities={aniQualities}
          resumeFrom={
            livePositionRef.current > 1
              ? Math.floor(livePositionRef.current)
              : resumeFrom
          }
          skipOpening={skipOpening}
          skipEnding={skipEnding}
          onEnded={onEnded}
          onTimeUpdate={bumpPosition}
        />
      ) : source === 'own' && hasOwnPlayer ? (
        // Реальный OwnPlayer живёт в PipPlayerHost (см. app/layout.tsx), сюда
        // он приезжает порталом — см. эффект show/hide ниже. Так Picture-in-
        // Picture переживает уход с этой страницы.
        <div ref={ownPlayerDockRef} />
      ) : source === 'yummy' && hasYummy ? (
        <YummyPlayer
          shikimoriId={shikimoriId}
          episode={activeEpisode}
          animeTitle={animeTitle}
          posterUrl={posterUrl}
          isAuthed={isAuthed}
          translations={yummyTranslations}
          resumeFrom={resumeFrom}
          onEnded={onEnded}
        />
      ) : (
        <KodikPlayer
          key={kodikEmbed}
          shikimoriId={shikimoriId}
          contentType={contentType}
          episode={activeEpisode}
          animeTitle={animeTitle}
          posterUrl={posterUrl}
          isAuthed={isAuthed}
          initialEmbedUrl={kodikEmbed}
          translations={kodikTranslations}
          initialTranslationId={kodikInitialTranslationId}
          fallback={kodikFallback}
          hasAlternatives={!!aniQualities || hasYummy || hasOwnPlayer}
          onEnded={onEnded}
          onTimeUpdate={bumpPosition}
          onEpisodeChange={onEpisodeChange}
        />
      )}

      {/* Навигация по сериям */}
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <button
            type="button"
            onClick={() => switchEpisode(activeEpisode - 1)}
            className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-gray-100 ring-1 ring-white/10 transition hover:bg-bg-soft"
          >
            ← Пред.
          </button>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg bg-bg-card/50 px-4 py-2 text-sm font-medium text-gray-400 ring-1 ring-white/10"
          >
            ← Пред.
          </span>
        )}
        {hasNext ? (
          <button
            type="button"
            onClick={() => switchEpisode(activeEpisode + 1)}
            className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-gray-100 ring-1 ring-white/10 transition hover:bg-bg-soft"
          >
            След. →
          </button>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg bg-bg-card/50 px-4 py-2 text-sm font-medium text-gray-400 ring-1 ring-white/10"
          >
            След. →
          </span>
        )}
      </div>

      {/* Плашка окончания серии */}
      {ended && hasNext && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-sm">
          <span>
            Серия {activeEpisode} просмотрена.
            {autoNext !== null && (
              <span className="text-gray-400">
                {' '}
                Следующая включится через пару секунд…
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {autoNext !== null && (
              <button
                type="button"
                onClick={cancelAutoNext}
                className="rounded-md px-3 py-1.5 font-medium text-gray-300 ring-1 ring-white/10 hover:text-white"
              >
                Отмена
              </button>
            )}
            <button
              type="button"
              onClick={() => switchEpisode(activeEpisode + 1)}
              className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              Следующая серия →
            </button>
          </div>
        </div>
      )}

      {!isAuthed && (
        <p className="rounded-lg border border-white/5 bg-bg-card px-4 py-3 text-sm text-gray-400">
          Вы смотрите как гость — прогресс не сохраняется.{' '}
          <Link href="/login" className="text-accent hover:underline">
            Войдите
          </Link>
          , чтобы синхронизировать позицию между устройствами.
        </p>
      )}

      {/* Предыдущий сезон франшизы — компактно, под плеером */}
      {prequels.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-white/5 pt-4">
          <h2 className="text-base font-semibold">Предыдущий сезон</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {prequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {/* Продолжение франшизы — компактно, под плеером */}
      {sequels.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-white/5 pt-4">
          <h2 className="text-base font-semibold">Продолжение</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {sequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {/* Похожее — компактно, под плеером */}
      {similar.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-white/5 pt-4">
          <h2 className="text-base font-semibold">Похожее</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {similar.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
