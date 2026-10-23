/**
 * Подписи глав и канонические ссылки читателя.
 *
 * Файл клиентобезопасен: только тип-импорт, без серверных модулей.
 */

import type { SourceId } from './types';

/** «21.2» / 21.2 / «Пролог» → число. Нечисловое → null. */
export function normalizeChapterNo(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;
  if (/^(prologue|пролог|начало)$/i.test(text)) return 0;

  const match = text.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Полная подпись: «Том 2, глава 1.1 — Название». */
export function formatChapterLabel(input: {
  tome?: number | null;
  number?: string | number | null;
  name?: string | null;
}): string {
  const raw = input.number == null ? '' : String(input.number).trim();
  const base = !raw || raw === '0' ? 'Пролог' : `Глава ${raw}`;
  const tome =
    input.tome != null && input.tome > 1 ? `Том ${input.tome}, ` : '';
  const name = (input.name ?? '').trim();

  const tail = !name
    ? base
    : name === base || name.startsWith(base)
      ? name
      : `${base} — ${name}`;

  return `${tome}${tail}`;
}

/** Короткая подпись: «Том 2, глава 1.1». */
export function chapterShortLabel(input: {
  tome?: number | null;
  number?: string | number | null;
}): string {
  const raw = input.number == null ? '' : String(input.number).trim();
  const base = !raw || raw === '0' ? 'Пролог' : `Глава ${raw}`;
  return input.tome != null && input.tome > 1
    ? `Том ${input.tome}, ${base}`
    : base;
}

/** Короткая метка источника для бейджа. */
export function sourceShortLabel(source: SourceId): string {
  switch (source) {
    case 'remanga':
      return 'RM';
    case 'mangadex':
      return 'MD';
    case 'mangalib':
      return 'ML';
    case 'selfmanga':
      return 'SM';
    case 'mintmanga':
      return 'MM';
    case 'yai':
      return 'YAI';
    case 'renovels':
      return 'RN';
    case 'flibusta':
      return 'FB';
  }
}

/** Человеческое имя источника для атрибуции. */
export function sourceTitleLabel(source: SourceId): string {
  switch (source) {
    case 'remanga':
      return 'Remanga';
    case 'mangadex':
      return 'MangaDex';
    case 'mangalib':
      return 'MangaLib';
    case 'selfmanga':
      return 'SelfManga';
    case 'mintmanga':
      return 'MintManga';
    case 'yai':
      return 'Yai';
    case 'renovels':
      return 'Renovels';
    case 'flibusta':
      return 'Флибуста';
  }
}

/**
 * Каноническая ссылка на читатель манги.
 * `idx` — канонический номер главы, не id источника.
 */
export function mangaReaderHref(
  dir: string,
  idx: number,
  source?: SourceId,
): string {
  const base = `/manga/read/${encodeURIComponent(dir)}/${idx}`;
  return source ? `${base}?source=${encodeURIComponent(source)}` : base;
}

/** Каноническая ссылка на читатель ранобэ. */
export function ranobeReaderHref(
  dir: string,
  idx: number,
  source?: SourceId,
): string {
  const base = `/ranobe/read/${encodeURIComponent(dir)}/${idx}`;
  return source ? `${base}?source=${encodeURIComponent(source)}` : base;
}
