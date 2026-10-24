'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AudioControls, { SKIP_SECONDS, type AudioControlsActions, type AudioControlsState } from '@/components/audio/AudioControls';
import PosterImage from '@/components/PosterImage';
import { XIcon } from '@/components/social/icons';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { createClient } from '@/lib/supabase/client';

/**
 * Общий плеер звука — подкасты и аудиокниги (24.10.2026).
 *
 * Раньше <audio> жил внутри страницы, и уход с неё (стрелка «назад», клик в
 * шапке) обрывал выпуск. Теперь звук один на весь сайт и живёт здесь, в
 * корневом layout, — как видео в PipPlayerHost. Страница подкаста или
 * аудиокниги только управляет им (useAudioPlayer). Ушли со страницы — звук
 * продолжается, внизу полоска «что играет»; нажатие на неё открывает окно:
 * пауза, перемотка, следующий выпуск/часть, скорость, громкость.
 *
 * Здесь же — всё, что должно жить дольше страницы:
 *   • прогресс в watch_progress (общий useProgressSaver);
 *   • место в каждом начатом выпуске — episode_marks (миграция 0065): по
 *     нему список выпусков показывает «в процессе», а выпуск продолжается
 *     со своего места; дослушанный выпуск метку теряет — «прослушан» берётся
 *     из watched_episodes;
 *   • громкость (между заходами — localStorage) и экран блокировки.
 */

export interface AudioTrack {
  /** Номер выпуска/части (1..N) — episode в watch_progress. */
  index: number;
  title: string;
  url: string;
  /** Запасная ссылка (через наш прокси), если основная не загрузилась. */
  fallbackUrl?: string;
  durationSeconds: number;
  imageUrl?: string | null;
}

export interface AudioSession {
  kind: 'podcast' | 'audiobook';
  id: number;
  title: string;
  /** Автор аудиокниги / автор подкаста — для экрана блокировки. */
  subtitle?: string | null;
  coverUrl: string | null;
  tracks: AudioTrack[];
  /** Страница, где этот звук «живёт»: на ней полоску внизу не показываем. */
  pageHref: string;
  isAuthed: boolean;
  /** Дослушали — включить следующий. Аудиокнига — да, подкаст — нет:
   *  выпуски не связаны сюжетом и часто слушаются не подряд. */
  autoAdvance: boolean;
}

interface AudioPlayerContext {
  session: AudioSession | null;
  track: AudioTrack | null;
  state: AudioControlsState;
  actions: AudioControlsActions;
  /** Играет ли (или поставлен на паузу) именно этот подкаст/аудиокнига. */
  isActive: (kind: AudioSession['kind'], id: number) => boolean;
  /** Загрузить сессию и встать на выпуск/часть с секунды. */
  start: (session: AudioSession, trackIndex: number, position?: number, autoplay?: boolean) => void;
  /** Перейти на выпуск/часть текущей сессии. */
  goTo: (trackIndex: number, position?: number, autoplay?: boolean) => void;
  close: () => void;
}

const Ctx = createContext<AudioPlayerContext | null>(null);

export function useAudioPlayer(): AudioPlayerContext {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAudioPlayer вне AudioPlayerProvider');
  return value;
}

const VOLUME_KEY = 'mw:audio-volume';
const MARK_INTERVAL_MS = 15_000;
/** Дальше этой доли выпуск считается дослушанным — та же граница, что у
 *  watched_episode в useProgressSaver. */
const DONE_RATIO = 0.9;

export default function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const pendingSeekRef = useRef(0);
  const resumeRef = useRef(false);

  const [session, setSession] = useState<AudioSession | null>(null);
  const [trackPos, setTrackPos] = useState(0);
  const [useFallback, setUseFallback] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const track = session?.tracks[trackPos] ?? null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const trackRef = useRef(track);
  trackRef.current = track;

  // Громкость между заходами — копия в браузере (localStorage недоступен в
  // приватном режиме — тогда просто 100 %).
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(VOLUME_KEY));
      if (Number.isFinite(stored) && stored >= 0 && stored <= 1 && window.localStorage.getItem(VOLUME_KEY) !== null) {
        setVolumeState(stored);
      }
    } catch {
      // без сохранённой громкости
    }
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  const save = useProgressSaver({
    contentType: session?.kind ?? 'podcast',
    shikimoriId: session?.id ?? 0,
    animeTitle: session?.title ?? '',
    posterUrl: session?.coverUrl ?? null,
    isAuthed: !!session?.isAuthed,
    getState: () => ({
      position: positionRef.current,
      duration: durationRef.current ?? trackRef.current?.durationSeconds ?? null,
      translationId: null,
      translationTitle: null,
      episode: trackRef.current?.index ?? 1,
    }),
    playingRef,
  });

  /** Метка «в процессе» с местом — или снятие метки у дослушанного. */
  const saveMark = useCallback(() => {
    const s = sessionRef.current;
    const t = trackRef.current;
    if (!s?.isAuthed || !t) return;
    const position = positionRef.current;
    if (!Number.isFinite(position) || position < 5) return;
    const total = durationRef.current ?? t.durationSeconds;
    const supabase = createClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const key = { user_id: user.id, content_type: s.kind, shikimori_id: s.id, episode: t.index };
      if (total > 0 && position / total > DONE_RATIO) {
        await supabase
          .from('episode_marks')
          .delete()
          .eq('user_id', key.user_id)
          .eq('content_type', key.content_type)
          .eq('shikimori_id', key.shikimori_id)
          .eq('episode', key.episode);
      } else {
        await supabase.from('episode_marks').upsert(
          {
            ...key,
            status: 'in_progress',
            position_seconds: position,
            duration_seconds: total > 0 ? total : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,content_type,shikimori_id,episode' },
        );
      }
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (playingRef.current) saveMark();
    }, MARK_INTERVAL_MS);
    const onHide = () => saveMark();
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onHide);
    };
  }, [saveMark]);

  /** Сохранить место уходящего выпуска и обнулить его, чтобы прощальное
   *  сохранение хука не записало старую секунду под новым выпуском. */
  const flushBeforeSwitch = useCallback(() => {
    save();
    saveMark();
    positionRef.current = 0;
    durationRef.current = null;
  }, [save, saveMark]);

  const start = useCallback(
    (next: AudioSession, trackIndex: number, position = 0, autoplay = true) => {
      const pos = Math.max(0, next.tracks.findIndex((t) => t.index === trackIndex));
      flushBeforeSwitch();
      pendingSeekRef.current = position;
      resumeRef.current = autoplay;
      setUseFallback(false);
      setCurrent(position);
      setDuration(next.tracks[pos]?.durationSeconds ?? 0);
      setSession(next);
      setTrackPos(pos);
      // Тот же файл (сессия обновилась, выпуск тот же) — src не меняется и
      // метаданные заново не придут: применяем сразу.
      const el = audioRef.current;
      const sameSrc = el && next.tracks[pos] && el.src && el.src.endsWith(next.tracks[pos].url);
      if (el && sameSrc) {
        // В том числе 0: «с начала» на том же файле — тоже перемотка.
        el.currentTime = position;
        if (autoplay) void el.play().catch(() => undefined);
        pendingSeekRef.current = 0;
        resumeRef.current = false;
      }
    },
    [flushBeforeSwitch],
  );

  const goTo = useCallback(
    (trackIndex: number, position = 0, autoplay = playingRef.current) => {
      const s = sessionRef.current;
      if (!s) return;
      start(s, trackIndex, position, autoplay);
    },
    [start],
  );

  const close = useCallback(() => {
    flushBeforeSwitch();
    audioRef.current?.pause();
    setSheetOpen(false);
    setSession(null);
  }, [flushBeforeSwitch]);

  const actions: AudioControlsActions = useMemo(
    () => ({
      toggle: () => {
        const el = audioRef.current;
        if (!el) return;
        if (el.paused) void el.play().catch(() => undefined);
        else el.pause();
      },
      seek: (seconds) => {
        const el = audioRef.current;
        if (el) el.currentTime = Math.max(0, seconds);
      },
      skip: (delta) => {
        const el = audioRef.current;
        if (!el) return;
        const end = Number.isFinite(el.duration) ? el.duration : Infinity;
        el.currentTime = Math.max(0, Math.min(end, el.currentTime + delta));
      },
      prev: () => {
        const s = sessionRef.current;
        const t = trackRef.current;
        if (!s || !t) return;
        const i = s.tracks.findIndex((x) => x.index === t.index);
        if (i > 0) goTo(s.tracks[i - 1].index, 0);
      },
      next: () => {
        const s = sessionRef.current;
        const t = trackRef.current;
        if (!s || !t) return;
        const i = s.tracks.findIndex((x) => x.index === t.index);
        if (i >= 0 && i < s.tracks.length - 1) goTo(s.tracks[i + 1].index, 0);
      },
      setRate: (r) => {
        const el = audioRef.current;
        if (el) el.playbackRate = r;
        setRateState(r);
      },
      setVolume: (v) => {
        const value = Math.max(0, Math.min(1, v));
        setVolumeState(value);
        setMuted(value === 0);
        try {
          window.localStorage.setItem(VOLUME_KEY, String(value));
        } catch {
          // без сохранения
        }
      },
      toggleMute: () => setMuted((m) => !m),
    }),
    [goTo],
  );

  // Экран блокировки и гарнитура.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const media = navigator.mediaSession;
    try {
      if (!session || !track) {
        media.metadata = null;
        return;
      }
      media.metadata = new MediaMetadata({
        title: track.title,
        artist: session.subtitle ?? '',
        album: session.title,
        artwork: (track.imageUrl ?? session.coverUrl) ? [{ src: (track.imageUrl ?? session.coverUrl) as string }] : [],
      });
      media.setActionHandler('play', () => actions.toggle());
      media.setActionHandler('pause', () => actions.toggle());
      media.setActionHandler('seekbackward', () => actions.skip(-SKIP_SECONDS));
      media.setActionHandler('seekforward', () => actions.skip(SKIP_SECONDS));
      media.setActionHandler('previoustrack', trackPos > 0 ? () => actions.prev() : null);
      media.setActionHandler('nexttrack', trackPos < session.tracks.length - 1 ? () => actions.next() : null);
    } catch {
      // старые браузеры знают не все действия
    }
  }, [session, track, trackPos, actions]);

  const isActive = useCallback(
    (kind: AudioSession['kind'], id: number) => session?.kind === kind && session.id === id,
    [session],
  );

  const state: AudioControlsState = {
    playing,
    current,
    duration: duration || track?.durationSeconds || 0,
    rate,
    volume,
    muted,
    hasPrev: trackPos > 0,
    hasNext: !!session && trackPos < session.tracks.length - 1,
  };

  const value: AudioPlayerContext = {
    session,
    track,
    state,
    actions,
    isActive,
    start,
    goTo,
    close,
  };

  const pathname = usePathname();
  const onOwnPage = !!session && (pathname === session.pageHref || pathname.startsWith(`${session.pageHref}/`));
  const showBar = !!session && !!track && !onOwnPage;
  const src = track ? (useFallback && track.fallbackUrl ? track.fallbackUrl : track.url) : undefined;
  const noun = session?.kind === 'audiobook' ? 'часть' : 'выпуск';

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => {
          playingRef.current = true;
          setPlaying(true);
        }}
        onPause={() => {
          playingRef.current = false;
          setPlaying(false);
          save();
          saveMark();
        }}
        onEnded={() => {
          playingRef.current = false;
          setPlaying(false);
          save();
          saveMark();
          if (session?.autoAdvance && trackPos < session.tracks.length - 1) {
            goTo(session.tracks[trackPos + 1].index, 0, true);
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          positionRef.current = t;
          setCurrent(t);
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration)) {
            durationRef.current = el.duration;
            setDuration(el.duration);
          }
          const seek = pendingSeekRef.current;
          // Не за конец: сохранённое место могло быть из другой версии файла.
          if (seek > 0) el.currentTime = Number.isFinite(el.duration) && seek > el.duration - 3 ? 0 : seek;
          pendingSeekRef.current = 0;
          el.playbackRate = rate;
          el.volume = volume;
          el.muted = muted;
          if (resumeRef.current) void el.play().catch(() => undefined);
          resumeRef.current = false;
        }}
        onError={() => {
          // Основная ссылка не загрузилась — один раз через запасную с того же места.
          if (!useFallback && track?.fallbackUrl && track.fallbackUrl !== track.url) {
            pendingSeekRef.current = positionRef.current;
            resumeRef.current = playingRef.current;
            setUseFallback(true);
          }
        }}
        onRateChange={(e) => setRateState(e.currentTarget.playbackRate)}
      />

      {showBar && session && track ? (
        <>
          {/* Запас под полоску: она fixed, и низ страницы иначе прятался бы под ней. */}
          <div aria-hidden="true" className="h-16" />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-2 md:bottom-4">
            <div className="relative mx-auto flex max-w-xl items-center gap-3 overflow-hidden rounded-2xl bg-bg-card/95 p-2 pr-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="press flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-label={`Открыть плеер: ${session.title}`}
              >
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-bg-soft">
                  <PosterImage sources={[track.imageUrl, session.coverUrl]} alt="" className="h-full w-full object-cover" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{track.title}</span>
                  <span className="truncate text-xs text-gray-400">{session.title}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={actions.toggle}
                aria-label={playing ? 'Пауза' : 'Слушать'}
                className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                    <rect x="6" y="5" width="4" height="14" rx="1.2" />
                    <rect x="14" y="5" width="4" height="14" rx="1.2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                    <path d="M7.5 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.05-6.4a1.2 1.2 0 0 0 0-2.04L9.34 4.58A1.2 1.2 0 0 0 7.5 5.6Z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Остановить и закрыть плеер"
                className="press grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-400 hover:text-white"
              >
                <XIcon className="h-4 w-4" />
              </button>
              {/* Тонкий прогресс выпуска по нижнему краю полоски. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full"
              >
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${state.duration > 0 ? Math.min(100, (current / state.duration) * 100) : 0}%` }}
                />
              </span>
            </div>
          </div>
        </>
      ) : null}

      {sheetOpen && session && track ? (
        <PlayerSheet
          session={session}
          track={track}
          state={state}
          actions={actions}
          noun={noun}
          onClose={() => setSheetOpen(false)}
          onStop={close}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** Окно плеера по нажатию на полоску: снизу на телефоне, по центру на ПК. */
function PlayerSheet({
  session,
  track,
  state,
  actions,
  noun,
  onClose,
  onStop,
}: {
  session: AudioSession;
  track: AudioTrack;
  state: AudioControlsState;
  actions: AudioControlsActions;
  noun: string;
  onClose: () => void;
  onStop: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const position = session.tracks.findIndex((t) => t.index === track.index) + 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Плеер: ${session.title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col gap-4 rounded-t-3xl bg-bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-white/10 md:rounded-3xl md:pb-5"
      >
        <div className="flex items-start gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-bg-soft">
            <PosterImage sources={[track.imageUrl, session.coverUrl]} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-xs text-gray-400">
              {noun === 'часть' ? 'Часть' : 'Выпуск'} {position} из {session.tracks.length}
            </p>
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{track.title}</p>
            <p className="truncate text-xs text-gray-400">{session.title}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Свернуть плеер"
            className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 hover:bg-white/10 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <AudioControls
          state={state}
          actions={actions}
          prevLabel={noun === 'часть' ? 'Предыдущая часть' : 'Предыдущий выпуск'}
          nextLabel={noun === 'часть' ? 'Следующая часть' : 'Следующий выпуск'}
          compact
        />

        <div className="flex items-center justify-between gap-3 text-sm">
          <Link
            // У подкаста страница — у каждого выпуска своя.
            href={session.kind === 'podcast' ? `${session.pageHref}/${track.index}` : session.pageHref}
            onClick={onClose}
            className="text-accent-text hover:underline"
          >
            Открыть страницу
          </Link>
          <button type="button" onClick={onStop} className="press text-gray-400 hover:text-white">
            Остановить и закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
