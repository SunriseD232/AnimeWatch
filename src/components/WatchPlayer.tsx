'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import HlsPlayer from '@/components/HlsPlayer';
import KodikPlayer from '@/components/KodikPlayer';
import {
  episodeQualities,
  getRelease,
  pickEpisode,
  resolveReleaseId,
  type HlsQuality,
} from '@/lib/anilibria';
import type { Translation } from '@/lib/video/types';
import type { ContentType, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';

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
  // Данные Kodik (fallback), подготовленные на сервере.
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
}

type Source = 'hls' | 'kodik';

const PREF_KEY = 'aw:preferredSource';

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
  resumeFrom,
  otherEpisode,
  isAuthed,
  kodikEmbedUrl,
  kodikTranslations,
  kodikInitialTranslationId,
  kodikFallback,
}: Props) {
  const { toast } = useToast();

  const [resolving, setResolving] = useState(true);
  // null = AniLibria недоступна для этого тайтла/серии.
  const [aniQualities, setAniQualities] = useState<HlsQuality[] | null>(null);
  const [source, setSource] = useState<Source>('kodik');
  const [kodikEmbed, setKodikEmbed] = useState(kodikEmbedUrl);
  const [switching, setSwitching] = useState(false);
  const [ended, setEnded] = useState(false);
  const [showOtherBanner, setShowOtherBanner] = useState(otherEpisode !== null);
  // Активная серия: может измениться из самого плеера Kodik (внутренняя навигация).
  const [activeEpisode, setActiveEpisode] = useState(episode);

  // Синхронизируем активную серию, когда сменился маршрут (наши кнопки «След./Пред.»).
  useEffect(() => {
    setActiveEpisode(episode);
  }, [episode]);

  // При навигации по маршруту сервер отдаёт новый Kodik-embed — обновляем iframe.
  useEffect(() => {
    setKodikEmbed(kodikEmbedUrl);
  }, [kodikEmbedUrl]);

  const isCinema = contentType === 'cinema';

  const playingRef = useRef(false);
  // Актуальная позиция активного плеера — для переноса при смене источника.
  const livePositionRef = useRef<number>(resumeFrom ?? 0);
  const bumpPosition = useCallback((t: number) => {
    if (Number.isFinite(t) && t > 0) livePositionRef.current = t;
  }, []);

  const hasNext = activeEpisode < total;
  const hasPrev = activeEpisode > 1;

  // --- Подбор источника: AniLibria → иначе Kodik (только для аниме) ---
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
              const ep = pickEpisode(rel, episode);
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
      // Учитываем сохранённое предпочтение пользователя.
      const pref =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(PREF_KEY)
          : null;
      setSource(q ? (pref === 'kodik' ? 'kodik' : 'hls') : 'kodik');
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isCinema, animeRomaji, animeRussian, animeYear, episode]);

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
            episode: String(episode),
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
    [source, switching, shikimoriId, episode, kodikInitialTranslationId],
  );

  // --- Тост о восстановленной позиции ---
  useEffect(() => {
    if (resumeFrom && resumeFrom > 5) {
      toast(`Вы остановились на ${formatTime(resumeFrom)}`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Окончание серии: пометить следующую и показать кнопку ---
  const onEnded = useCallback(() => {
    setEnded(true);
    if (isAuthed && hasNext) {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          episode: activeEpisode + 1,
          position_seconds: 5,
          duration_seconds: null,
          translation_id: null,
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [
    isAuthed,
    hasNext,
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
    activeEpisode,
  ]);

  // --- Смена серии внутри плеера Kodik → обновляем номер/навигацию ---
  const onEpisodeChange = useCallback((ep: number) => {
    setActiveEpisode(ep);
    setEnded(false);
  }, []);

  // --- Realtime между устройствами (last-write-wins) ---
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
          if (isBackground && row.episode !== episode) {
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
  }, [isAuthed, shikimoriId, episode, toast]);

  const watchBase = isCinema ? '/cinema/watch' : '/watch';
  const detailHref = `${isCinema ? '/cinema' : '/anime'}/${shikimoriId}`;

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
            <Link
              href={`${watchBase}/${shikimoriId}/${otherEpisode}`}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              Перейти
            </Link>
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

      {/* Переключатель источника — когда AniLibria доступна как альтернатива */}
      {!resolving && aniQualities && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Плеер:</span>
          <div className="inline-flex rounded-lg bg-bg-card p-0.5 ring-1 ring-white/5">
            <button
              type="button"
              onClick={() => switchTo('hls')}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                source === 'hls'
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              AniLibria · {aniQualities[0]?.label ?? '720'}p
            </button>
            <button
              type="button"
              onClick={() => switchTo('kodik')}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                source === 'kodik'
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              Kodik
            </button>
          </div>
          {switching && (
            <span className="text-xs text-gray-500">переключаем…</span>
          )}
        </div>
      )}

      {/* Медиа */}
      {resolving ? (
        <div className="skeleton flex aspect-video w-full items-center justify-center">
          <span className="text-sm text-gray-500">Подбираем источник…</span>
        </div>
      ) : source === 'hls' && aniQualities ? (
        <HlsPlayer
          shikimoriId={shikimoriId}
          episode={episode}
          animeTitle={animeTitle}
          posterUrl={posterUrl}
          isAuthed={isAuthed}
          qualities={aniQualities}
          resumeFrom={
            livePositionRef.current > 1
              ? Math.floor(livePositionRef.current)
              : resumeFrom
          }
          onEnded={onEnded}
          onTimeUpdate={bumpPosition}
        />
      ) : (
        <KodikPlayer
          key={kodikEmbed}
          shikimoriId={shikimoriId}
          contentType={contentType}
          episode={episode}
          animeTitle={animeTitle}
          posterUrl={posterUrl}
          isAuthed={isAuthed}
          initialEmbedUrl={kodikEmbed}
          translations={kodikTranslations}
          initialTranslationId={kodikInitialTranslationId}
          fallback={kodikFallback}
          onEnded={onEnded}
          onTimeUpdate={bumpPosition}
          onEpisodeChange={onEpisodeChange}
        />
      )}

      {/* Навигация по сериям */}
      <div className="flex items-center gap-2">
        <Link
          href={hasPrev ? `${watchBase}/${shikimoriId}/${activeEpisode - 1}` : '#'}
          aria-disabled={!hasPrev}
          className={[
            'rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            hasPrev
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          ← Пред.
        </Link>
        <Link
          href={hasNext ? `${watchBase}/${shikimoriId}/${activeEpisode + 1}` : '#'}
          aria-disabled={!hasNext}
          className={[
            'rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            hasNext
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          След. →
        </Link>
      </div>

      {/* Плашка окончания серии */}
      {ended && hasNext && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-sm">
          <span>Серия {activeEpisode} просмотрена.</span>
          <Link
            href={`${watchBase}/${shikimoriId}/${activeEpisode + 1}`}
            className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover"
          >
            Следующая серия →
          </Link>
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
    </div>
  );
}
