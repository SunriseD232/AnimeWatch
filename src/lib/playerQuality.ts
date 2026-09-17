/**
 * Качество видео по умолчанию — личная настройка (профиль → Настройки →
 * Плеер).
 *
 * Хранится на устройстве (localStorage, рядом с громкостью и скоростью), а
 * при включённой синхронизации дублируется в аккаунт (profiles, миграция
 * 0038/0039) и переносится на другие устройства — см. PlayerPrefsSync.
 * Устройство остаётся источником для самого плеера: он читает значение
 * синхронно, прямо в обработчике манифеста hls.js, где ждать сеть негде.
 *
 * Значение — не «жёсткое требование», а цель: наборы высот у источников
 * разные, поэтому выбираем ближайшее доступное, см. pickQualityHeight.
 */

/** «Авто» первым: это самый мягкий вариант, а не крайность шкалы. */
export const QUALITY_OPTIONS = ['auto', 480, 720, 1080] as const;

export type PreferredQuality = (typeof QUALITY_OPTIONS)[number];

/** Плеер сам подбирает качество под скорость (обычный ABR). */
export const AUTO_QUALITY = 'auto';

/** Верх шкалы: «самое высокое, что отдаёт источник». */
export const MAX_QUALITY = 1080;

/**
 * По умолчанию 480p — ровно то поведение, что было у плеера до появления
 * этой настройки (см. ветку videoseed в OwnPlayer): менять его молча всем
 * уже смотрящим людям незачем, кто хочет иначе — теперь может выбрать.
 */
export const DEFAULT_QUALITY: PreferredQuality = 480;

/** Настройка плеера на стороне аккаунта (см. миграцию 0038). */
export interface PlayerPrefs {
  /** null — человек ничего не выбирал: зеркало на устройстве не трогаем. */
  quality: PreferredQuality | null;
  /** Синхронизировать ли выбор между устройствами. */
  sync: boolean;
}

/** Приводит что угодно (строку из БД/localStorage, число) к варианту. */
export function normalizeQuality(value: unknown): PreferredQuality | null {
  if (value == null) return null;
  const raw = String(value);
  if (raw === AUTO_QUALITY) return AUTO_QUALITY;
  const num = Number(raw);
  return (QUALITY_OPTIONS as readonly (string | number)[]).includes(num) ? (num as PreferredQuality) : null;
}

const KEY = 'mediawatch:player-quality';

export function readPreferredQuality(): PreferredQuality {
  try {
    return normalizeQuality(localStorage.getItem(KEY)) ?? DEFAULT_QUALITY;
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
 * Правила: «авто» — не ограничиваем вовсе (null, решает сам плеер). 1080 —
 * самое высокое, что есть. Для 480/720 берём самое высокое, что НЕ ВЫШЕ
 * выбранного (выбрал 480 — не подсовываем 720, иначе настройка не имеет
 * смысла на мобильном интернете), а если всё доступное выше — самое низкое
 * из имеющихся.
 */
export function pickQualityHeight(heights: number[], preferred: PreferredQuality): number | null {
  if (preferred === AUTO_QUALITY) return null;
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
