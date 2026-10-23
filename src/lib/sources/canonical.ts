/**
 * Канонизация глав.
 *
 * У источников разная нумерация: Remanga отдаёт index/number, MangaDex —
 * строку `chapter`, у Флибусты вообще тома. Чтобы прогресс и «Продолжить»
 * не съезжали при смене источника, главы сливаются в одну ось:
 *
 *   canonical_chapters.idx = 1..N
 *
 * Слияние идёт по номеру главы (21.2), а не по позиции в списке.
 */

import type {
  CanonicalChapter,
  ChapterSourceRef,
  SourceChapter,
  SourceId,
} from './types';

export interface SourceChapterGroup {
  source: SourceId;
  variant: string;
  chapters: SourceChapter[];
}

interface Entry {
  source: SourceId;
  variant: string;
  chapter: SourceChapter;
  order: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Чем выше — тем лучше версия одной и той же главы у источника. */
function chapterScore(chapter: SourceChapter): number {
  const free = chapter.isFreeToday ? 100 : 0;
  const open = chapter.isPaid ? 0 : 10;
  const pages = Math.min(chapter.pagesCount ?? 0, 1000);
  return free + open + pages;
}

/**
 * Сливает главы всех источников в каноническую ось.
 *
 * Правила:
 *  - числовые главы сортируются по chapterNo;
 *  - главы без номера дописываются в конец с шагом 0.001;
 *  - дубли одной главы у (source, variant) схлопываются по chapterScore;
 *  - idx присваивается после слияния.
 */
export function mergeChapters(
  groups: SourceChapterGroup[],
): CanonicalChapter[] {
  const numeric: Entry[] = [];
  const unknown: Entry[] = [];
  let order = 0;

  for (const group of groups) {
    const variant = group.variant || 'default';
    for (const chapter of group.chapters) {
      const entry: Entry = {
        source: group.source,
        variant,
        chapter,
        order: order++,
      };

      if (
        chapter.chapterNo != null &&
        Number.isFinite(chapter.chapterNo)
      ) {
        numeric.push(entry);
      } else {
        unknown.push(entry);
      }
    }
  }

  const tomeOf = (entry: Entry): number =>
    entry.chapter.tome != null && Number.isFinite(entry.chapter.tome)
      ? entry.chapter.tome
      : 0;

  unknown.sort((a, b) => a.order - b.order);

  // Сначала группируем по номеру главы: MangaDex часто не отдаёт том, и без
  // этого «том 1, глава 5» не слилась бы с «глава 5». Если у одного номера
  // реально несколько томов — разделяем по тому.
  const byNumber = new Map<number, { entries: Entry[]; tomes: Set<number> }>();

  for (const entry of numeric) {
    const no = round3(entry.chapter.chapterNo as number);
    let group = byNumber.get(no);
    if (!group) {
      group = { entries: [], tomes: new Set() };
      byNumber.set(no, group);
    }
    group.entries.push(entry);

    const tome = tomeOf(entry);
    if (tome > 0) group.tomes.add(tome);
  }

  const ordered: { tome: number; no: number; entries: Entry[] }[] = [];

  for (const no of [...byNumber.keys()].sort((a, b) => a - b)) {
    const group = byNumber.get(no) as {
      entries: Entry[];
      tomes: Set<number>;
    };

    if (group.tomes.size <= 1) {
      const tome = group.tomes.size === 1 ? [...group.tomes][0] : 0;
      ordered.push({ tome, no, entries: group.entries });
      continue;
    }

    // Реальный конфликт: несколько томов с одинаковым номером главы.
    // Записи без тома прикрепляем к минимальному тому.
    const fallbackTome = Math.min(...group.tomes);
    const byTome = new Map<number, Entry[]>();

    for (const entry of group.entries) {
      const tome = tomeOf(entry) || fallbackTome;
      const bucket = byTome.get(tome) ?? [];
      bucket.push(entry);
      byTome.set(tome, bucket);
    }

    for (const tome of [...byTome.keys()].sort((a, b) => a - b)) {
      ordered.push({ tome, no, entries: byTome.get(tome) as Entry[] });
    }
  }

  // Глава, которую ни один источник не привязал к тому (MangaDex часто не
  // отдаёт volume), иначе получила бы tome=0 и при сортировке ниже уехала бы
  // в начало оглавления — раньше первого тома. Наследуем том предыдущей по
  // номеру главы: «глава 101» без тома встаёт после «тома 10, главы 100».
  let carriedTome = 0;
  for (const bucket of ordered) {
    if (bucket.tome > 0) carriedTome = bucket.tome;
    else bucket.tome = carriedTome;
  }

  // Читательский порядок: том, затем глава.
  ordered.sort((a, b) => a.tome - b.tome || a.no - b.no);

  let lastTome = ordered.length > 0 ? ordered[ordered.length - 1].tome : 0;
  let lastNo = ordered.length > 0 ? ordered[ordered.length - 1].no : 0;
  for (const entry of unknown) {
    lastTome = tomeOf(entry) || lastTome;
    lastNo = round3(lastNo + 0.001);
    ordered.push({ tome: lastTome, no: lastNo, entries: [entry] });
  }

  const result: CanonicalChapter[] = [];
  let idx = 0;

  for (const bucket of ordered) {
    // Одна версия главы на (source, variant).
    const best = new Map<string, Entry>();
    for (const entry of bucket.entries) {
      const key = `${entry.source}:${entry.variant}`;
      const current = best.get(key);
      if (!current || chapterScore(entry.chapter) > chapterScore(current.chapter)) {
        best.set(key, entry);
      }
    }
    if (best.size === 0) continue;

    idx += 1;

    const label =
      bucket.entries
        .map((entry) => entry.chapter.label.trim())
        .find((value) => value.length > 0) ?? `Глава ${bucket.no}`;

    const sources: ChapterSourceRef[] = [...best.values()].map((entry) => ({
      source: entry.source,
      variant: entry.variant,
      chapterKey: entry.chapter.chapterKey,
      isPaid: entry.chapter.isPaid,
      isFreeToday: entry.chapter.isFreeToday,
      pagesCount: entry.chapter.pagesCount,
    }));

    result.push({
      idx,
      chapterNo: bucket.no,
      tome: bucket.tome > 0 ? bucket.tome : null,
      label,
      sources,
    });
  }

  return result;
}

/** Есть ли у канонической главы хоть один бесплатный источник. */
export function hasFreeSource(chapter: CanonicalChapter): boolean {
  return chapter.sources.some(
    (source) => !source.isPaid || source.isFreeToday,
  );
}
