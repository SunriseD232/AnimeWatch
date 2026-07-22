import { createHmac } from 'crypto';

/**
 * Код регистрации — детерминированно выводится из текущей UTC-даты и
 * секрета (SIGNUP_CODE_SECRET), поэтому не нужна ни таблица в БД, ни крон
 * на ротацию: он «сам» меняется в полночь UTC, а /code и /api/signup всегда
 * считают его одинаково.
 *
 * Алфавит без визуально спутываемых символов (0/O, 1/I/L).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Код на сегодня. null, если SIGNUP_CODE_SECRET не задан — это должно
 * блокировать регистрацию (fail closed), а не открывать её всем подряд.
 */
export function getTodaysSignupCode(): string | null {
  const secret = process.env.SIGNUP_CODE_SECRET;
  if (!secret) return null;

  const digest = createHmac('sha256', secret).update(todayUtc()).digest();
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[digest[i] % ALPHABET.length];
  }
  return code;
}

/** Сравнение без учёта регистра/пробелов по краям — люди копируют с пробелом. */
export function verifySignupCode(input: string): boolean {
  const today = getTodaysSignupCode();
  if (!today) return false;
  return input.trim().toUpperCase() === today;
}
