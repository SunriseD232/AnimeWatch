/**
 * Синхронизация места между книгой и её аудиокнигой — этап 1 (24.10.2026):
 * оценка по главам и доле текста. Модуль чистый: без сети и React —
 * считают сервер (предложения «продолжить отсюда») и тесты.
 *
 * Общая единица — ДОЛЯ ТЕКСТА книги по символам (0..1). EPUB-читатель её и
 * хранит (epub.js строит карту мест по объёму текста), FB2 — тоже
 * (locator.textFraction, см. Fb2Reader). У записи место — часть + секунда.
 *
 * Как переводим одно в другое: строим опорные точки «секунда записи ↔ доля
 * текста» и между ними считаем пропорцию.
 *   • Начало записи — после объявления («Аудиокнига… читает…»), конец — до
 *     титров: INTRO_SECONDS и OUTRO_SECONDS.
 *   • Главы. Если частей записи столько же, сколько разделов книги на одном
 *     уровне, — начало части i = начало раздела i. Иначе — по номерам: часть
 *     «Глава 12» ↔ раздел «Глава 12», только если номер однозначен с обеих
 *     сторон. Файлы, нарезанные по 30 минут («01», «02»…), главами не
 *     считаются — тогда остаётся пропорция по всей книге.
 * Ошибка внутри главы — темп чтеца; её снимает этап 2 (распознавание
 * короткого фрагмента записи и поиск фразы в тексте).
 */

export interface AudioPart {
  title: string;
  durationSeconds: number;
}

export interface TextSection {
  title: string;
  /** Уровень вложенности (0 — верхний). */
  depth: number;
  /** Начало раздела — доля текста 0..1. */
  start: number;
}

export interface AudioPosition {
  /** Часть 1..N. */
  chapterIndex: number;
  /** Секунда внутри части. */
  position: number;
}

interface Anchor {
  /** Секунда от начала всей записи. */
  t: number;
  /** Доля текста. */
  f: number;
}

const INTRO_SECONDS = 15;
const OUTRO_SECONDS = 20;
/** Меньше стольких частей — главами их не считаем: «Часть 1, Часть 2» у
 *  двухфайловой записи ничего не говорят о структуре книги. */
const MIN_PARTS_FOR_CHAPTERS = 3;

/** Номер главы из названия: «Глава 12», «ГЛАВА XII», «12. Встреча», «Chapter 3». */
export function chapterNumber(title: string): number | null {
  const t = title.trim().toLowerCase();
  const word = t.match(/(?:глава|гл\.|chapter)\s*([0-9]+|[ivxlc]+)\b/);
  if (word) return toNumber(word[1]);
  const lead = t.match(/^([0-9]+)[.)]\s+\S/);
  return lead ? Number(lead[1]) : null;
}

function toNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const roman: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const cur = roman[value[i]];
    const next = roman[value[i + 1]] ?? 0;
    if (!cur) return null;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

/** Номер части, если её название — просто номер файла («01», «Часть 02»):
 *  такие части — нарезка, а не главы. */
function isFileNumber(title: string): boolean {
  return /^(?:часть|трек|файл|запись)?\s*\d+$/i.test(title.trim());
}

function partStarts(parts: AudioPart[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const part of parts) {
    starts.push(acc);
    acc += Math.max(0, part.durationSeconds);
  }
  return starts;
}

function totalDuration(parts: AudioPart[]): number {
  return parts.reduce((sum, part) => sum + Math.max(0, part.durationSeconds), 0);
}

/** Опорные точки, строго возрастающие по обеим осям. */
export function buildAnchors(parts: AudioPart[], sections: TextSection[]): Anchor[] {
  const total = totalDuration(parts);
  const intro = Math.min(INTRO_SECONDS, total * 0.05);
  const outro = Math.min(OUTRO_SECONDS, total * 0.05);
  const anchors: Anchor[] = [{ t: intro, f: 0 }];
  const starts = partStarts(parts);

  const chapterLike = parts.length >= MIN_PARTS_FOR_CHAPTERS && !parts.every((p) => isFileNumber(p.title));
  if (chapterLike && sections.length > 0) {
    // 1. Столько же разделов на каком-то уровне — часть i ↔ раздел i.
    const depths = [...new Set(sections.map((s) => s.depth))].sort((a, b) => a - b);
    const level = depths
      .map((depth) => sections.filter((s) => s.depth === depth))
      .find((list) => list.length === parts.length);
    if (level) {
      level.forEach((section, i) => {
        if (i > 0) anchors.push({ t: starts[i], f: section.start });
      });
    } else {
      // 2. По номерам глав — только однозначные с обеих сторон.
      const byNumber = (list: { title: string }[]) => {
        const map = new Map<number, number>();
        const dup = new Set<number>();
        list.forEach((item, i) => {
          const n = chapterNumber(item.title);
          if (n == null) return;
          if (map.has(n)) dup.add(n);
          map.set(n, i);
        });
        for (const n of dup) map.delete(n);
        return map;
      };
      const partNo = byNumber(parts);
      const sectionNo = byNumber(sections);
      for (const [n, partIndex] of [...partNo.entries()].sort((a, b) => a[1] - b[1])) {
        const sectionIndex = sectionNo.get(n);
        if (sectionIndex == null || partIndex === 0) continue;
        anchors.push({ t: starts[partIndex], f: sections[sectionIndex].start });
      }
    }
  }

  anchors.push({ t: Math.max(intro + 1, total - outro), f: 1 });

  // Только возрастающие по обеим осям: неудачная пара (пролог в книге есть,
  // в записи нет) не должна развернуть пропорцию назад.
  anchors.sort((a, b) => a.t - b.t);
  const clean: Anchor[] = [];
  for (const anchor of anchors) {
    const last = clean[clean.length - 1];
    if (!last || (anchor.t > last.t && anchor.f > last.f)) clean.push(anchor);
  }
  return clean;
}

function interpolate(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const span = xs[i] - xs[i - 1];
      return span > 0 ? ys[i - 1] + ((x - xs[i - 1]) / span) * (ys[i] - ys[i - 1]) : ys[i];
    }
  }
  return ys[ys.length - 1];
}

/** Место в записи → доля текста книги. */
export function audioToTextFraction(
  parts: AudioPart[],
  position: AudioPosition,
  sections: TextSection[] = [],
): number {
  if (parts.length === 0) return 0;
  const anchors = buildAnchors(parts, sections);
  const starts = partStarts(parts);
  const index = Math.min(Math.max(1, position.chapterIndex), parts.length) - 1;
  const t = starts[index] + Math.max(0, position.position);
  const f = interpolate(t, anchors.map((a) => a.t), anchors.map((a) => a.f));
  return Math.max(0, Math.min(1, f));
}

/** Доля текста → место в записи. backoff — отступить назад, чтобы не начать
 *  посреди фразы (оценка неточная). */
export function textFractionToAudio(
  parts: AudioPart[],
  fraction: number,
  sections: TextSection[] = [],
  backoffSeconds = 15,
): AudioPosition {
  if (parts.length === 0) return { chapterIndex: 1, position: 0 };
  const anchors = buildAnchors(parts, sections);
  const f = Math.max(0, Math.min(1, fraction));
  const t = Math.max(0, interpolate(f, anchors.map((a) => a.f), anchors.map((a) => a.t)) - backoffSeconds);
  const starts = partStarts(parts);
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (t >= starts[i]) index = i;
  return { chapterIndex: index + 1, position: Math.floor(t - starts[index]) };
}
