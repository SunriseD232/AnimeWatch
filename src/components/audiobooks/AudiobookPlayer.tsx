'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { formatTime } from '@/lib/format';
import type { AudiobookChapter } from '@/lib/audiobookShared';

/** Шаг кнопок перемотки и стрелок — 10 секунд: у аудиокниги «прослушал
 *  фразу — вернуть» важнее, чем быстрый проход, как у подкастов (24.10.2026). */
const SKIP_SECONDS = 10;
const RATES = [0.75, 1, 1.25, 1.5, 2];

export interface AudiobookSyncOffer {
  /** «В книге вы остановились на 34 %». */
  text: string;
  /** Куда перейти, если согласиться: глава 1..N и секунда в ней. */
  chapterIndex: number;
  position: number;
  /** Доля текста книги — для уточнения по речи (этап 2, /api/sync/refine). */
  fraction: number;
}

type RefineState = 'idle' | 'working' | 'refined' | 'approx';

/**
 * Плеер аудиокниги. Основа — плеер подкастов (PodcastPlayer): свой <audio>,
 * прогресс через общий useProgressSaver. Отличия:
 *
 *   • главы идут подряд: дослушал главу — сама включается следующая. У
 *     подкаста выпуски не связаны, у книги — связаны;
 *   • звук — прямо с knigavuhe (трафик не идёт через наш сервер). Не
 *     загрузился — один раз переключаемся на ту же главу через наш прокси
 *     (chapter.fallbackUrl) с того же места;
 *   • кнопки −10 / +10 секунд и управление с экрана блокировки (Media
 *     Session): на телефоне аудиокнигу слушают с погашенным экраном;
 *   • подсказка синхронизации с книгой (lib/bookAudioSync.ts): если в
 *     книге человек ушёл дальше, плеер предлагает продолжить оттуда — не
 *     прыгает молча, место по оценке может быть неточным.
 *
 * В watch_progress: episode — номер главы, position — секунда в ней.
 */
export default function AudiobookPlayer({
  audiobookId,
  title,
  authors,
  coverUrl,
  chapters,
  isAuthed,
  startChapter = 1,
  startPosition = 0,
  syncOffer = null,
}: {
  audiobookId: number;
  title: string;
  authors: string[];
  coverUrl: string | null;
  chapters: AudiobookChapter[];
  isAuthed: boolean;
  startChapter?: number;
  startPosition?: number;
  syncOffer?: AudiobookSyncOffer | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const positionRef = useRef(startPosition);
  const durationRef = useRef<number | null>(null);
  /** Куда встать, когда загрузятся метаданные новой главы. */
  const pendingSeekRef = useRef<number>(startPosition);
  /** Продолжать играть после смены главы (автопереход, выбор из списка). */
  const resumeRef = useRef(false);

  const initial = Math.min(Math.max(1, startChapter), chapters.length);
  const [chapterNo, setChapterNo] = useState(initial);
  // Для асинхронного уточнения: текущая часть на момент ответа сервера.
  const chapterNoRef = useRef(initial);
  chapterNoRef.current = chapterNo;
  const [useFallback, setUseFallback] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(startPosition);
  const [duration, setDuration] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState(syncOffer);
  const [refine, setRefine] = useState<RefineState>('idle');

  const chapter = chapters[chapterNo - 1];
  const src = chapter ? (useFallback ? chapter.fallbackUrl : chapter.url) : '';

  const save = useProgressSaver({
    contentType: 'audiobook',
    shikimoriId: audiobookId,
    animeTitle: title,
    posterUrl: coverUrl,
    isAuthed,
    getState: () => ({
      position: positionRef.current,
      duration: durationRef.current ?? chapter?.durationSeconds ?? null,
      translationId: null,
      translationTitle: null,
      episode: chapterNo,
    }),
    playingRef,
  });

  const goToChapter = useCallback(
    (no: number, position = 0, keepPlaying = playingRef.current) => {
      if (no < 1 || no > chapters.length) return;
      save();
      pendingSeekRef.current = position;
      resumeRef.current = keepPlaying;
      positionRef.current = position;
      durationRef.current = null;
      setCurrent(position);
      setDuration(null);
      setFailed(false);
      setUseFallback(false);
      setChapterNo(no);
    },
    [chapters.length, save],
  );

  const skip = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const end = Number.isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.max(0, Math.min(end, el.currentTime + delta));
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  // Клавиши: пробел — пауза, стрелки — ±10 с. Не перехватываем в полях
  // ввода и на кнопках (иначе ломается навигация с клавиатуры).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select|button/i.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        skip(SKIP_SECONDS);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        skip(-SKIP_SECONDS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, skip]);

  // Экран блокировки и гарнитура: название, обложка, ±10 с, главы.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !chapter) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: chapter.title,
        artist: authors.join(', '),
        album: title,
        artwork: coverUrl ? [{ src: coverUrl }] : [],
      });
      session.setActionHandler('seekbackward', () => skip(-SKIP_SECONDS));
      session.setActionHandler('seekforward', () => skip(SKIP_SECONDS));
      session.setActionHandler('previoustrack', chapterNo > 1 ? () => goToChapter(chapterNo - 1) : null);
      session.setActionHandler('nexttrack', chapterNo < chapters.length ? () => goToChapter(chapterNo + 1) : null);
    } catch {
      // Старые браузеры знают не все действия — обходимся без них.
    }
  }, [chapter, chapterNo, chapters.length, authors, title, coverUrl, skip, goToChapter]);

  /**
   * Этап 2: оценка этапа 1 сразу, точное место — когда сервер распознает
   * фрагмент записи (~15 с). Перематываем, только если человек за это время
   * не ушёл далеко от оценки сам: иначе мы бы дёрнули его назад.
   */
  async function refinePlace(target: AudiobookSyncOffer) {
    setRefine('working');
    try {
      const res = await fetch('/api/sync/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audiobookId, direction: 'toAudio', fraction: target.fraction }),
      });
      const data = (await res.json()) as { status?: string; chapterIndex?: number; position?: number };
      const stillNear =
        chapterNoRef.current === target.chapterIndex &&
        Math.abs(positionRef.current - target.position) < 120;
      if (data.status === 'refined' && data.chapterIndex && data.position != null && stillNear) {
        goToChapter(data.chapterIndex, data.position, playingRef.current);
        setRefine('refined');
      } else {
        setRefine('approx');
      }
    } catch {
      setRefine('approx');
    }
  }

  if (!chapter) {
    return (
      <p className="rounded-2xl bg-bg-card p-4 text-sm text-gray-400 ring-1 ring-inset ring-white/5">
        Главы этой аудиокниги сейчас недоступны: источник не ответил. Попробуйте открыть её позже.
      </p>
    );
  }

  const shown = scrubbing ?? current;
  const total = duration ?? chapter.durationSeconds;
  const percent = total > 0 ? (shown / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
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
        }}
        onEnded={() => {
          playingRef.current = false;
          setPlaying(false);
          save();
          // Следующая глава — сама: книга слушается подряд.
          if (chapterNo < chapters.length) goToChapter(chapterNo + 1, 0, true);
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
          // Не за конец главы: сохранённое место могло быть из другой записи.
          if (seek > 0) el.currentTime = Number.isFinite(el.duration) && seek > el.duration - 3 ? 0 : seek;
          pendingSeekRef.current = 0;
          el.playbackRate = rate;
          if (resumeRef.current) void el.play().catch(() => undefined);
          resumeRef.current = false;
        }}
        onError={() => {
          // Прямая ссылка не загрузилась — пробуем через наш прокси с того же
          // места; не загрузилась и она — честно говорим.
          if (!useFallback && chapter.fallbackUrl !== chapter.url) {
            pendingSeekRef.current = positionRef.current;
            resumeRef.current = playingRef.current;
            setUseFallback(true);
          } else {
            setFailed(true);
          }
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      />

      {offer ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-accent/10 p-3 text-sm ring-1 ring-inset ring-accent/30 sm:flex-row sm:items-center">
          <p className="flex-1 text-gray-100">{offer.text}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                goToChapter(offer.chapterIndex, offer.position, false);
                setOffer(null);
                void refinePlace(offer);
              }}
              className="press rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              Продолжить отсюда
            </button>
            <button
              type="button"
              onClick={() => setOffer(null)}
              className="press rounded-full px-3 py-1.5 text-xs text-gray-300 ring-1 ring-white/15 hover:text-white"
            >
              С места в записи
            </button>
          </div>
        </div>
      ) : null}

      {refine !== 'idle' ? (
        <p role="status" className="text-xs text-gray-400">
          {refine === 'working'
            ? 'Уточняем место по записи — около 15 секунд. Можно слушать.'
            : refine === 'refined'
              ? 'Место уточнено по тексту книги.'
              : 'Точнее найти не получилось — осталось примерное место.'}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-400">
          Часть {chapterNo} из {chapters.length}
        </p>
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{chapter.title}</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">{formatTime(shown)}</span>
        <input
          type="range"
          min={0}
          max={total > 0 ? total : 100}
          step={1}
          value={shown}
          aria-label="Позиция в главе"
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            const el = audioRef.current;
            if (el && scrubbing != null) el.currentTime = scrubbing;
            setScrubbing(null);
          }}
          onKeyUp={() => setScrubbing(null)}
          style={{
            background: `linear-gradient(to right, rgb(var(--accent)) ${percent}%, rgb(var(--bg-soft)) ${percent}%)`,
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
        />
        <span className="w-14 shrink-0 text-xs tabular-nums text-gray-400">
          {total > 0 ? formatTime(total) : '—:—'}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <RoundButton label="Предыдущая часть" disabled={chapterNo <= 1} onClick={() => goToChapter(chapterNo - 1)}>
          <path d="M6 5v14M18 6l-9 6 9 6V6z" />
        </RoundButton>
        <SkipButton seconds={-SKIP_SECONDS} onClick={() => skip(-SKIP_SECONDS)} />
        <button
          type="button"
          onClick={toggle}
          className="press grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-fg"
          aria-label={playing ? 'Пауза' : 'Слушать'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
              <path d="M7.5 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.05-6.4a1.2 1.2 0 0 0 0-2.04L9.34 4.58A1.2 1.2 0 0 0 7.5 5.6Z" />
            </svg>
          )}
        </button>
        <SkipButton seconds={SKIP_SECONDS} onClick={() => skip(SKIP_SECONDS)} />
        <RoundButton
          label="Следующая часть"
          disabled={chapterNo >= chapters.length}
          onClick={() => goToChapter(chapterNo + 1)}
        >
          <path d="M18 5v14M6 6l9 6-9 6V6z" />
        </RoundButton>

        <div className="flex items-center gap-1 rounded-full bg-bg-soft p-1 ring-1 ring-white/10 sm:ml-auto">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                const el = audioRef.current;
                if (el) el.playbackRate = r;
                setRate(r);
              }}
              aria-pressed={rate === r}
              className={[
                'press rounded-full px-2 py-1 text-xs font-medium tabular-nums transition',
                rate === r ? 'bg-accent text-accent-fg' : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className="text-xs text-red-300">
          Эта часть не загружается ни напрямую, ни через наш сервер. Попробуйте следующую часть или
          откройте книгу позже.
        </p>
      ) : null}
      {!isAuthed ? (
        <p className="text-xs text-gray-400">
          Войдите, чтобы место сохранялось и книга появилась в «Продолжить слушать».
        </p>
      ) : null}

      <details className="rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
          Части ({chapters.length})
        </summary>
        <ol className="max-h-80 overflow-y-auto pb-2">
          {chapters.map((c) => (
            <li key={c.index}>
              <button
                type="button"
                onClick={() => goToChapter(c.index, 0, true)}
                aria-current={c.index === chapterNo ? 'true' : undefined}
                className={[
                  'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition',
                  c.index === chapterNo
                    ? 'bg-accent/15 font-semibold text-accent-text'
                    : 'text-gray-300 hover:bg-bg-soft hover:text-white',
                ].join(' ')}
              >
                <span className="line-clamp-1">{c.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {c.durationSeconds > 0 ? formatTime(c.durationSeconds) : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function RoundButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="press grid h-10 w-10 place-items-center rounded-full bg-bg-soft text-gray-200 ring-1 ring-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4 fill-none stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

/** Кнопка «−10» / «+10»: круговая стрелка с числом внутри, как в системных
 *  плеерах. Экспортируется — та же кнопка у подкастов. */
export function SkipButton({ seconds, onClick }: { seconds: number; onClick: () => void }) {
  const back = seconds < 0;
  const label = `${back ? 'Назад' : 'Вперёд'} на ${Math.abs(seconds)} секунд`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press relative grid h-11 w-11 place-items-center rounded-full bg-bg-soft text-gray-200 ring-1 ring-white/10 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`h-8 w-8 fill-none stroke-current ${back ? '' : '-scale-x-100'}`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
        <path d="M4 3.5v3.7h3.7" />
      </svg>
      <span className="absolute text-[10px] font-semibold tabular-nums">{Math.abs(seconds)}</span>
    </button>
  );
}
