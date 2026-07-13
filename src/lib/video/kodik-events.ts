/**
 * Ключи событий, которые Kodik-плеер шлёт родительскому окну через postMessage.
 * Вынесены в константы, чтобы легко сверять/менять при обновлении API Kodik.
 */
export const KODIK_EVENTS = {
  TIME_UPDATE: 'kodik_player_time_update',
  DURATION_UPDATE: 'kodik_player_duration_update',
  VIDEO_STARTED: 'kodik_player_video_started',
  PLAY: 'kodik_player_play',
  PAUSE: 'kodik_player_pause',
  VIDEO_ENDED: 'kodik_player_video_ended',
} as const;

/** Формат события Kodik. */
export interface KodikMessage {
  key: string;
  value?: number;
}
