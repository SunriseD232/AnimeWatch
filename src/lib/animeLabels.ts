/**
 * Подписи типа и статуса тайтла — те же, что на странице тайтла.
 *
 * Вынесены из app/anime/[shikimoriId]/page.tsx, когда те же самые подписи
 * понадобились списочному виду каталога. Держать две копии значило бы, что
 * однажды в каталоге появится «ТВ», а на странице тайтла останется
 * «ТВ-сериал» — и никто не заметит, пока не откроет обе рядом.
 *
 * Это НЕ то же самое, что KIND_OPTIONS/STATUS_OPTIONS в lib/animeFilters.ts:
 * там подписи для фильтра, они короче и рассчитаны на узкий чекбокс
 * («Завершён» вместо «Вышло»), а здесь — для показа рядом с названием.
 */

export const KIND_LABELS: Record<string, string> = {
  tv: 'ТВ-сериал',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  tv_special: 'Короткометражка',
  music: 'Клип',
};

export const STATUS_LABELS: Record<string, string> = {
  anons: 'Анонс',
  ongoing: 'Онгоинг',
  released: 'Вышло',
};

export function kindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return KIND_LABELS[kind] ?? kind;
}

export function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUS_LABELS[status] ?? status;
}
