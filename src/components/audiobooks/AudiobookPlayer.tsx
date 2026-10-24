'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AudioControls, { SKIP_SECONDS, type AudioControlsActions, type AudioControlsState } from '@/components/audio/AudioControls';
import { useAudioPlayer, type AudioSession } from '@/components/audio/AudioPlayerProvider';
import { formatTime } from '@/lib/format';
import type { AudiobookChapter } from '@/lib/audiobookShared';

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
 * Плеер аудиокниги — пульт общего плеера (AudioPlayerProvider): звук живёт
 * в корневом layout, и уход со страницы его не обрывает (24.10.2026).
 *
 *   • части идут подряд: дослушал — включается следующая (autoAdvance);
 *   • звук — прямо с knigavuhe, не загрузился — тот же файл через наш
 *     прокси (fallbackUrl) с того же места; это делает общий плеер;
 *   • −10 / +10, скорость, громкость, экран блокировки;
 *   • подсказка синхронизации с книгой (lib/syncOffers.ts): «Продолжить
 *     отсюда» сразу ставит оценку этапа 1 и в фоне уточняет место по речи
 *     (этап 2); не прыгаем молча — решает человек.
 *
 * В watch_progress: episode — номер части, position — секунда в ней.
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
  const audio = useAudioPlayer();
  const [offer, setOffer] = useState(syncOffer);
  const [refine, setRefine] = useState<RefineState>('idle');

  const session: AudioSession = useMemo(
    () => ({
      kind: 'audiobook',
      id: audiobookId,
      title,
      subtitle: authors.join(', ') || null,
      coverUrl,
      tracks: chapters.map((c) => ({
        index: c.index,
        title: c.title,
        url: c.url,
        fallbackUrl: c.fallbackUrl,
        durationSeconds: c.durationSeconds,
      })),
      pageHref: `/audiobooks/${audiobookId}`,
      isAuthed,
      autoAdvance: true,
    }),
    [audiobookId, title, authors, coverUrl, chapters, isAuthed],
  );

  const active = audio.isActive('audiobook', audiobookId);
  const firstChapter = Math.min(Math.max(1, startChapter), Math.max(1, chapters.length));
  const chapterNo = active && audio.track ? audio.track.index : firstChapter;
  const chapter = chapters[chapterNo - 1];

  /** Встать на часть с секунды: в общем плеере, загрузив книгу, если играла
   *  не она. */
  const goToChapter = (no: number, position = 0, play?: boolean) => {
    if (no < 1 || no > chapters.length) return;
    if (active) audio.goTo(no, position, play);
    else audio.start(session, no, position, play ?? false);
  };

  // Для асинхронного уточнения: где мы на момент ответа сервера.
  const whereRef = useRef({ chapter: chapterNo, position: active ? audio.state.current : startPosition });
  whereRef.current = { chapter: chapterNo, position: active ? audio.state.current : startPosition };

  const state: AudioControlsState = active
    ? audio.state
    : {
        ...audio.state,
        playing: false,
        current: startPosition,
        duration: chapter?.durationSeconds ?? 0,
        hasPrev: firstChapter > 1,
        hasNext: firstChapter < chapters.length,
      };

  const actions: AudioControlsActions = active
    ? audio.actions
    : {
        ...audio.actions,
        toggle: () => audio.start(session, firstChapter, startPosition, true),
        seek: (seconds) => audio.start(session, firstChapter, seconds, false),
        skip: (delta) => audio.start(session, firstChapter, Math.max(0, startPosition + delta), false),
        prev: () => audio.start(session, firstChapter - 1, 0, false),
        next: () => audio.start(session, firstChapter + 1, 0, false),
      };

  // Пробел — пауза, стрелки — ±10 с. Не в полях ввода и не на кнопках.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select|button/i.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        actionsRef.current.toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        actionsRef.current.skip(SKIP_SECONDS);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        actionsRef.current.skip(-SKIP_SECONDS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      const here = whereRef.current;
      const stillNear = here.chapter === target.chapterIndex && Math.abs(here.position - target.position) < 120;
      if (data.status === 'refined' && data.chapterIndex && data.position != null && stillNear) {
        audio.goTo(data.chapterIndex, data.position);
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

  return (
    <div className="flex flex-col gap-4">
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

      {audio.session && !active ? (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-gray-400">
          Сейчас играет: {audio.track?.title} — {audio.session.title}. «Слушать» здесь переключит на эту книгу.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-400">
          Часть {chapterNo} из {chapters.length}
        </p>
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{chapter.title}</p>
      </div>

      <AudioControls state={state} actions={actions} prevLabel="Предыдущая часть" nextLabel="Следующая часть" />

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
