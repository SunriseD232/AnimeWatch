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
  // Смена серии/сезона внутри самого плеера Kodik.
  CURRENT_EPISODE: 'kodik_player_current_episode',
} as const;

/** Формат события Kodik. Значение бывает числом или объектом (серия/сезон). */
export interface KodikMessage {
  key: string;
  value?: number | Record<string, unknown>;
}

/**
 * Достаёт номер серии из значения события Kodik. Значение приходит в разных
 * формах (число, либо объект `{ episode, season }`), поэтому разбираем гибко.
 */
export function parseEpisode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const raw = v.episode ?? v.episode_number ?? v.current_episode;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
