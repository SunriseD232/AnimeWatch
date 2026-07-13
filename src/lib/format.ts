/** Форматирует секунды в мм:сс или ч:мм:сс. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/** Процент просмотра серии (0..100), null если длительность неизвестна. */
export function watchPercent(
  position: number,
  duration: number | null | undefined,
): number | null {
  if (!duration || duration <= 0) return null;
  return Math.min(100, Math.round((position / duration) * 100));
}
