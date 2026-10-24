'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { SkipButton } from '@/components/audiobooks/AudiobookPlayer';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { formatTime } from '@/lib/format';
import type { PodcastEpisode } from '@/lib/podcastShared';

/**
 * Плеер подкаста. Свой <audio>, без внешних виджетов: единственное, что
 * нужно от подкаста, — воспроизведение файла, а родной <audio> умеет это
 * лучше любого встраивания, при этом не тянет чужих скриптов и работает в
 * PWA/офлайне так же, как остальные плееры сайта.
 *
 * Почему не <video>: аудиофайлы подкастов почти всегда mp3/m4a, и <audio>
 * даёт на мобильных правильную обработку фонового воспроизведения и экрана
 * блокировки, чего <video> с чёрным прямоугольником не даёт.
 *
 * Источник — уже подписанная ссылка нашего /api/proxy/raw (см.
 * lib/podcasts.ts → podcastAudioUrl). Прокси решает три вещи сразу: смешанный
 * контент из http-фидов, хотлинк-запреты части CDN и приватность (реальный
 * адрес фида наружу не уходит). Range/206 прокси уже поддерживает, поэтому
 * перемотка работает, а на диске не оседает ни байта.
 *
 * Прогресс пишет общий useProgressSaver — тот же, что у аниме и кино: у
 * подкаста нет сезонов и озвучек (season не передаём, translation_* = null),
 * а номер эпизода в watch_progress.episode — это index в фиде (см.
 * lib/podcasts.ts). Для своего подкаста watch_progress хранит ОДНУ строку —
 * позицию текущего эпизода; завершённые уходят в watched_episodes.
 *
 * Автовоспроизведения следующего эпизода здесь намеренно НЕТ. У сериала
 * «следующая серия» очевидна, у подкаста — нет: выпуски не связаны сюжетом, и
 * человек часто слушает не подряд. Дослушал — увидит список и выберет сам.
 */
export default function PodcastPlayer({
  podcastId,
  podcastTitle,
  artworkUrl,
  episode,
  episodes,
  isAuthed,
  /** Позиция в секундах, с которой продолжить (watch_progress), 0 — с начала. */
  startPosition = 0,
}: {
  podcastId: number;
  podcastTitle: string;
  artworkUrl: string | null;
  episode: PodcastEpisode;
  /** Все эпизоды — только для навигации «предыдущий/следующий» и списка. */
  episodes: PodcastEpisode[];
  isAuthed: boolean;
  startPosition?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(startPosition);
  const [duration, setDuration] = useState<number | null>(
    episode.durationSeconds > 0 ? episode.durationSeconds : null,
  );
  const [rate, setRate] = useState(1);
  // Ползунок тянется с опережением самого звука: иначе на медленной сети
  // ручка «отпрыгивает» назад, пока браузер догоняет буферизацию.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const index = episodes.findIndex((e) => e.index === episode.index);
  const prev = index > 0 ? episodes[index - 1] : null;
  const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null;

  const save = useProgressSaver({
    contentType: 'podcast',
    shikimoriId: podcastId,
    animeTitle: podcastTitle,
    posterUrl: artworkUrl,
    isAuthed,
    getState: () => ({
      position: positionRef.current,
      duration: durationRef.current,
      translationId: null,
      translationTitle: null,
      episode: episode.index,
    }),
    playingRef,
  });

  // Стартовая позиция: ставим после метаданных. durationchange/sec-loaded
  // раньше времени дали бы скачок в 0 — а server offset приходит
  // application/octet-stream + Accept-Ranges, и duration появляется не сразу.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || startPosition <= 0) return;
    const seek = () => {
      // Не улетаем за конец: сохранённая позиция может быть больше реальной
      // длительности, если фид когда-то отдавал другой файл.
      const d = Number.isFinite(el.duration) ? el.duration : null;
      el.currentTime = d && startPosition > d - 5 ? 0 : startPosition;
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
  }, [startPosition, episode.index]);

  // Смена эпизода (переход по «следующий») — начинаем с нуля.
  useEffect(() => {
    positionRef.current = 0;
    setCurrent(0);
    setDuration(episode.durationSeconds > 0 ? episode.durationSeconds : null);
    durationRef.current = null;
  }, [episode.index, episode.durationSeconds]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  // ±10 секунд — кнопками и стрелками (24.10.2026: тот же шаг, что у
  // аудиокниг; раньше стрелки перематывали на 15 с, а кнопок не было).
  const skip = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const end = Number.isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.max(0, Math.min(end, el.currentTime + delta));
  }, []);

  // Пробел — воспроизведение/пауза, стрелки — ±10 с. Не перехватываем, когда
  // фокус в поле ввода или на кнопке/ссылке (иначе ломаем Tab-навигацию).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        skip(10);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        skip(-10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, skip]);

  const shown = scrubbing ?? current;
  const total = duration ?? episode.durationSeconds;
  const percent = total > 0 ? (shown / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={episode.audioUrl}
        preload="metadata"
        // crossOrigin не ставим: файл идёт с нашего же домена через прокси,
        // и лишний CORS-заголовок тут только мешает кэшу.
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
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          positionRef.current = t;
          setCurrent(t);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) {
            durationRef.current = d;
            setDuration(d);
          }
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      />

      <div className="flex items-start gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-bg-soft sm:h-24 sm:w-24">
          <PosterImage
            sources={[episode.imageUrl, artworkUrl]}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{episode.title}</p>
          {episode.publishedAt ? (
            <p className="text-xs text-gray-400">
              {new Date(episode.publishedAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          ) : null}
        </div>
      </div>

      {/* Полоса перемотки. input[type=range] с Appearance на accent — так
          трек и ползунок наследуют акцент текущей темы без отдельного CSS. */}
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-gray-400">
          {formatTime(shown)}
        </span>
        <input
          type="range"
          min={0}
          max={total > 0 ? total : 100}
          step={1}
          value={shown}
          aria-label="Позиция воспроизведения"
          onChange={(e) => {
            const value = Number(e.target.value);
            setScrubbing(value);
          }}
          onPointerUp={() => {
            const el = audioRef.current;
            if (el && scrubbing != null) el.currentTime = scrubbing;
            setScrubbing(null);
          }}
          onKeyUp={() => setScrubbing(null)}
          style={{
            // Залитая часть до ручки — акцентом; после — нейтральным.
            background: `linear-gradient(to right, rgb(var(--accent)) ${percent}%, rgb(var(--bg-soft)) ${percent}%)`,
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
        />
        <span className="w-12 shrink-0 text-xs tabular-nums text-gray-400">
          {total > 0 ? formatTime(total) : '—:—'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {prev ? (
          <Link
            href={`/podcasts/listen/${podcastId}/${prev.index}`}
            className="press rounded-full bg-bg-soft px-3 py-2 text-sm ring-1 ring-white/10 hover:text-white"
            title={prev.title}
          >
            ← Пред.
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-full bg-bg-card/50 px-3 py-2 text-sm text-gray-400"
          >
            ← Пред.
          </span>
        )}

        <SkipButton seconds={-10} onClick={() => skip(-10)} />

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

        <SkipButton seconds={10} onClick={() => skip(10)} />

        {next ? (
          <Link
            href={`/podcasts/listen/${podcastId}/${next.index}`}
            className="press rounded-full bg-bg-soft px-3 py-2 text-sm ring-1 ring-white/10 hover:text-white"
            title={next.title}
          >
            След. →
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-full bg-bg-card/50 px-3 py-2 text-sm text-gray-400"
          >
            След. →
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 rounded-full bg-bg-soft p-1 ring-1 ring-white/10">
          {[1, 1.25, 1.5, 2].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                const el = audioRef.current;
                if (el) el.playbackRate = r;
              }}
              aria-pressed={rate === r}
              className={[
                'press rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition',
                rate === r ? 'bg-accent text-accent-fg' : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      {!isAuthed ? (
        <p className="text-xs text-gray-400">
          Войдите, чтобы прогресс слушания сохранялся и подкаст появился в «Продолжить слушать».
        </p>
      ) : null}
    </div>
  );
}
