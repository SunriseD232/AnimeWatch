/**
 * Качество видео по умолчанию — личная настройка (профиль → Настройки →
 * Плеер).
 *
 * Живёт в localStorage, рядом с громкостью и скоростью (см. OwnPlayer): это
 * настройка про КОНКРЕТНОЕ устройство, а не про аккаунт. На телефоне по
 * мобильному интернету разумный выбор один, на большом экране дома — другой,
 * и синхронизировать их между собой было бы скорее вредно.
 *
 * Значение — не «жёсткое требование», а цель: реальные высоты у источников
 * разные (240/360/480/720/1080, у кого-то только две), поэтому выбираем
 * ближайшее доступное, см. pickQualityLevel.
 */

export const QUALITY_OPTIONS = [480, 720, 1080] as const;

export type PreferredQuality = (typeof QUALITY_OPTIONS)[number];

/** 1080 означает «максимум, который отдаёт источник», а не ровно 1080p. */
export const MAX_QUALITY: PreferredQuality = 1080;

/**
 * По умолчанию 480p — ровно то поведение, что было у плеера до появления
 * этой настройки (см. ветку videoseed в OwnPlayer): менять его молча всем
 * уже смотрящим людям незачем, кто хочет выше — теперь может выбрать.
 */
export const DEFAULT_QUALITY: PreferredQuality = 480;

const KEY = 'mediawatch:player-quality';

export function readPreferredQuality(): PreferredQuality {
  try {
    const raw = Number(localStorage.getItem(KEY));
    return (QUALITY_OPTIONS as readonly number[]).includes(raw) ? (raw as PreferredQuality) : DEFAULT_QUALITY;
  } catch {
    // Приватный режим — просто работаем со значением по умолчанию.
    return DEFAULT_QUALITY;
  }
}

export function storePreferredQuality(quality: PreferredQuality): void {
  try {
    localStorage.setItem(KEY, String(quality));
  } catch {
    // Выбор не переживёт перезагрузку — но и падать тут не из-за чего.
  }
}

/**
 * Ближайшая к предпочтению высота из доступных.
 *
 * Правила: 1080 — это «самое высокое, что есть». Для 480/720 берём самое
 * высокое, что НЕ ВЫШЕ выбранного (выбрал 480 — не подсовываем 720, иначе
 * настройка не имеет смысла на мобильном интернете), а если всё доступное
 * выше — самое низкое из имеющихся.
 */
export function pickQualityHeight(heights: number[], preferred: PreferredQuality): number | null {
  const sorted = [...heights].filter((h) => Number.isFinite(h) && h > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return null;
  if (preferred === MAX_QUALITY) return sorted[0];
  return sorted.find((h) => h <= preferred) ?? sorted[sorted.length - 1];
}

/** То же, но сразу по списку уровней плеера. */
export function pickQualityLevel<T extends { height: number }>(
  levels: T[],
  preferred: PreferredQuality,
): T | null {
  const height = pickQualityHeight(
    levels.map((l) => l.height),
    preferred,
  );
  if (height == null) return null;
  return levels.find((l) => l.height === height) ?? null;
}
