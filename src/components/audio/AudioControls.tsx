'use client';

import { useState } from 'react';
import { formatTime } from '@/lib/format';

/** Шаг перемотки кнопками и стрелками — общий для подкастов и аудиокниг. */
export const SKIP_SECONDS = 10;
export const RATES = [0.75, 1, 1.25, 1.5, 2];

export interface AudioControlsState {
  playing: boolean;
  current: number;
  duration: number;
  rate: number;
  volume: number;
  muted: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface AudioControlsActions {
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  prev: () => void;
  next: () => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
}

/**
 * Кнопки плеера звука: полоса перемотки, −10 / +10, предыдущий/следующий,
 * воспроизведение, скорость, громкость. Одни и те же на странице подкаста,
 * на странице аудиокниги и в окне общего плеера (AudioPlayerProvider) —
 * чтобы управление не отличалось от места к месту.
 *
 * Подписи «предыдущий/следующий» — снаружи: у подкаста это выпуск, у
 * аудиокниги — часть.
 */
export default function AudioControls({
  state,
  actions,
  prevLabel,
  nextLabel,
  compact = false,
}: {
  state: AudioControlsState;
  actions: AudioControlsActions;
  prevLabel: string;
  nextLabel: string;
  compact?: boolean;
}) {
  // Ползунок тянется с опережением звука: иначе на медленной сети ручка
  // «отпрыгивает» назад, пока браузер догоняет буферизацию.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? state.current;
  const total = state.duration;
  const percent = total > 0 ? Math.min(100, (shown / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">{formatTime(shown)}</span>
        <input
          type="range"
          min={0}
          max={total > 0 ? total : 100}
          step={1}
          value={shown}
          aria-label="Позиция воспроизведения"
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing != null) actions.seek(scrubbing);
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing != null) actions.seek(scrubbing);
            setScrubbing(null);
          }}
          style={{
            background: `linear-gradient(to right, rgb(var(--accent)) ${percent}%, rgb(var(--bg-soft)) ${percent}%)`,
          }}
          className={RANGE_CLASS}
        />
        <span className="w-14 shrink-0 text-xs tabular-nums text-gray-400">
          {total > 0 ? formatTime(total) : '—:—'}
        </span>
      </div>

      <div className={`flex flex-wrap items-center justify-center gap-2 ${compact ? '' : 'sm:justify-start'}`}>
        <RoundButton label={prevLabel} disabled={!state.hasPrev} onClick={actions.prev}>
          <path d="M6 5v14M18 6l-9 6 9 6V6z" />
        </RoundButton>
        <SkipButton seconds={-SKIP_SECONDS} onClick={() => actions.skip(-SKIP_SECONDS)} />
        <button
          type="button"
          onClick={actions.toggle}
          className="press grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-fg"
          aria-label={state.playing ? 'Пауза' : 'Слушать'}
        >
          {state.playing ? (
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
        <SkipButton seconds={SKIP_SECONDS} onClick={() => actions.skip(SKIP_SECONDS)} />
        <RoundButton label={nextLabel} disabled={!state.hasNext} onClick={actions.next}>
          <path d="M18 5v14M6 6l9 6-9 6V6z" />
        </RoundButton>
      </div>

      <div className={`flex flex-wrap items-center justify-center gap-3 ${compact ? '' : 'sm:justify-between'}`}>
        <div className="flex items-center gap-1 rounded-full bg-bg-soft p-1 ring-1 ring-white/10">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => actions.setRate(r)}
              aria-pressed={state.rate === r}
              className={[
                'press rounded-full px-2 py-1 text-xs font-medium tabular-nums transition',
                state.rate === r ? 'bg-accent text-accent-fg' : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              {r}×
            </button>
          ))}
        </div>
        <VolumeControl state={state} actions={actions} />
      </div>
    </div>
  );
}

const RANGE_CLASS =
  'h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white';

/**
 * Громкость: кнопка «без звука» и ползунок. На телефонах (iOS) громкость
 * <audio> из страницы не меняется — там работает только системная; ползунок
 * при этом безвреден, а кнопка «без звука» работает везде.
 */
function VolumeControl({ state, actions }: { state: AudioControlsState; actions: AudioControlsActions }) {
  const level = state.muted ? 0 : state.volume;
  const percent = level * 100;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={actions.toggleMute}
        aria-label={state.muted ? 'Включить звук' : 'Выключить звук'}
        aria-pressed={state.muted}
        className="press grid h-9 w-9 place-items-center rounded-full text-gray-300 hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-5 w-5 fill-none stroke-current"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          {level === 0 ? (
            <>
              <path d="m22 9-6 6" />
              <path d="m16 9 6 6" />
            </>
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              {level > 0.5 ? <path d="M19 5a10 10 0 0 1 0 14" /> : null}
            </>
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={level}
        aria-label="Громкость"
        onChange={(e) => actions.setVolume(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, rgb(var(--accent)) ${percent}%, rgb(var(--bg-soft)) ${percent}%)`,
        }}
        className={`${RANGE_CLASS} w-24`}
      />
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
 *  плеерах. */
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
