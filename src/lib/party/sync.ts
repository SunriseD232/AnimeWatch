import type { PartyPlaybackState, PartyPlayerSnapshot } from './types';

/**
 * Что сделать со своим плеером, чтобы совпасть с комнатой. Чистая функция —
 * вся арифметика синхронизации здесь, без React и сети (проверяется
 * scripts/party-sync.test.mjs).
 */

/** Расхождение, которое уже исправляем перемоткой, пока видео играет.
 *  Меньше — терпим: перемотка у части источников (videoseed) стоит секунды
 *  загрузки и сама рождает новое расхождение. */
export const PLAYING_DRIFT_S = 1.5;
/** Когда все на паузе — ставим кадр точнее, перемотка на паузе дешёвая. */
export const PAUSED_DRIFT_S = 0.5;
/** После своей перемотки не перематываем снова, пока прошлая не доехала. */
export const SEEK_COOLDOWN_MS = 4_000;

export interface SyncDecision {
  seekTo: number | null;
  play: boolean;
  pause: boolean;
  rate: number | null;
}

const NOTHING: SyncDecision = { seekTo: null, play: false, pause: false, rate: null };

/** Где комната сейчас: позиция из снимка плюс прошедшее с него время. */
export function expectedPosition(state: PartyPlaybackState, serverNowMs: number): number {
  if (!state.playing) return state.time;
  return state.time + (Math.max(0, serverNowMs - state.at) / 1000) * state.rate;
}

export function decideSync(
  state: PartyPlaybackState,
  snap: PartyPlayerSnapshot,
  serverNowMs: number,
  msSinceOwnSeek: number,
): SyncDecision {
  // Видео грузится или перематывается — команды сейчас только помешают.
  if (!snap.ready) return NOTHING;
  const expected = expectedPosition(state, serverNowMs);
  // Комната уже за концом файла (кто-то досмотрел и вот-вот переключит
  // серию) — не дёргаем перемоткой в самый хвост.
  if (snap.duration != null && expected > snap.duration - 1) return NOTHING;
  const limit = state.playing ? PLAYING_DRIFT_S : PAUSED_DRIFT_S;
  const drift = Math.abs(snap.time - expected);
  return {
    seekTo: drift > limit && msSinceOwnSeek > SEEK_COOLDOWN_MS ? expected : null,
    play: state.playing && !snap.playing,
    pause: !state.playing && snap.playing,
    rate: Math.abs(snap.rate - state.rate) > 0.01 ? state.rate : null,
  };
}
