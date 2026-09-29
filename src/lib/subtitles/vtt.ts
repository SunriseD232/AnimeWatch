/**
 * Разбор WebVTT и поиск реплики по времени — для собственного рендера
 * субтитров в OwnPlayer.
 *
 * ЗАЧЕМ НЕ <track>. Раньше реплики брались из нативной дорожки (<track> +
 * TextTrack.activeCues). Но hls.js при каждом подключении к <video>
 * (attachMedia, в том числе при автоматическом переподключении после
 * зависания на дальней перемотке) и при загрузке манифеста вызывает у себя
 * _cleanTracks(): удаляет ВСЕ реплики из ВСЕХ текстовых дорожек элемента —
 * и из наших тоже (см. node_modules/hls.js/src/controller/timeline-controller.ts).
 * Файл <track> браузер повторно не скачивает, дорожка остаётся пустой, и
 * субтитры пропадают до перезагрузки страницы. Ровно это и было в жалобе
 * «перемотал далеко — субтитры пропали».
 *
 * Теперь реплики живут у нас в памяти, а активная выбирается по текущей
 * секунде видео. Что бы ни происходило с плеером — переподключение,
 * пересоздание MediaSource, прыжок через разрыв буфера, — субтитры
 * продолжаются с того места, где сейчас видео.
 */

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CueIndex {
  cues: Cue[];
  /** maxEnd[i] — самый поздний конец среди реплик 0..i. Нужен, чтобы найти
   *  длинную реплику, начавшуюся задолго до текущей секунды, не перебирая
   *  весь файл (см. activeCueText). */
  maxEnd: number[];
}

// ЧЧ:ММ:СС.ммм или ММ:СС.ммм. Запятая — на случай SRT, отданного под видом
// VTT: браузерный <track> такие файлы молча не показывал, мы их прочитаем.
const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseTimestamp(s: string): number | null {
  const m = TIMESTAMP.exec(s);
  if (!m) return null;
  const [, h, min, sec, ms] = m;
  return (
    (h ? Number(h) * 3600 : 0) + Number(min) * 60 + Number(sec) + Number(ms.padEnd(3, '0')) / 1000
  );
}

export function parseVtt(raw: string): CueIndex {
  const cues: Cue[] = [];
  const blocks = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingAt = lines.findIndex((l) => l.includes('-->'));
    if (timingAt < 0) continue;
    const [from, to] = lines[timingAt].split('-->');
    const start = parseTimestamp(from);
    const end = parseTimestamp(to);
    if (start == null || end == null || end <= start) continue;
    // Разметку WebVTT (<i>, <b>, <v Имя>) выбрасываем: рисуем обычным
    // текстом, а вставлять чужой HTML в DOM ради курсива не стоит риска.
    const text = lines
      .slice(timingAt + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (text) cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start);
  const maxEnd: number[] = [];
  let acc = -Infinity;
  for (const c of cues) {
    acc = Math.max(acc, c.end);
    maxEnd.push(acc);
  }
  return { cues, maxEnd };
}

/** Текст всех реплик, активных в момент t; одновременные — через lineBreak. */
export function activeCueText({ cues, maxEnd }: CueIndex, t: number, lineBreak: string): string {
  // Последняя реплика, начавшаяся не позже t (бинарный поиск).
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const parts: string[] = [];
  // Идём назад, пока среди оставшихся вообще может найтись реплика, ещё не
  // закончившаяся к t.
  for (let i = last; i >= 0 && maxEnd[i] > t; i--) {
    if (cues[i].end > t) parts.unshift(cues[i].text);
  }
  return parts.join(lineBreak);
}
