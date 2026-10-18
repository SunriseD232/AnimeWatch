/**
 * Пробный период Vibix — основного плеера кино с точным трекингом позиции
 * (см. ARCHITECTURE.md §7). Начался 17.07.2026 на 3 месяца, продлён ещё
 * на 3 месяца (до 17.01.2027) — после
 * окончания нужно продлевать/переподключать вручную (это делает человек,
 * не код), поэтому здесь только даты + вехи для предупреждений, ничего
 * автоматического с самим Vibix не происходит.
 */

// UTC-полночь — тот же принцип, что и у ротации кода регистрации
// (см. lib/signupCode.ts): без привязки к часовому поясу сервера.
export const VIBIX_TRIAL_START = new Date('2026-07-17T00:00:00Z');
export const VIBIX_TRIAL_END = new Date('2027-01-17T00:00:00Z');

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export interface VibixMilestone {
  /** Дедуп-ключ для system_notifications.key. */
  key: string;
  date: Date;
  /** Для текста «до истечения пробного периода Vibix осталось …». */
  label: string;
}

// Дата конца в ключе: вехи прошлого срока уже лежат в system_notifications
// под unique(user_id, key), и без этого после продления они бы не пришли.
const END_KEY = VIBIX_TRIAL_END.toISOString().slice(0, 10);

export const VIBIX_MILESTONES: VibixMilestone[] = [
  {
    key: `vibix-trial-1month-${END_KEY}`,
    date: addMonthsUtc(VIBIX_TRIAL_END, -1),
    label: 'месяц',
  },
  {
    key: `vibix-trial-2weeks-${END_KEY}`,
    date: addDaysUtc(VIBIX_TRIAL_END, -14),
    label: '2 недели',
  },
  {
    key: `vibix-trial-1week-${END_KEY}`,
    date: addDaysUtc(VIBIX_TRIAL_END, -7),
    label: 'неделю',
  },
];

/** Сколько дней осталось до конца пробного периода (может быть отрицательным). */
export function daysUntilVibixTrialEnd(from: Date = new Date()): number {
  const ms = VIBIX_TRIAL_END.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
