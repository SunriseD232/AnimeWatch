/**
 * Отображаемое имя: правила и запасная подпись.
 *
 * Модуль без серверных зависимостей — те же правила проверяет и форма в
 * профиле (чтобы ошибка появлялась сразу, без запроса), и /api/profile
 * (которому клиент может прислать что угодно).
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 32;

// Буквы любого алфавита, цифры и немного разделителей. Первый и последний
// символ — буква или цифра: имя из одних точек и подчёркиваний в списке
// друзей не отличить от пустого места.
const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._-]*[\p{L}\p{N}])?$/u;

// Слова, под которыми легко выдать себя за сайт или его администрацию.
// Проверяется вхождение, а не точное совпадение: «Админ_сайта» — то же самое.
const RESERVED = ['admin', 'админ', 'модератор', 'moderator', 'mediawatch', 'поддержка', 'support'];

/** Обрезает края и схлопывает пробелы — «  Neko   Chan » и «Neko Chan» одно имя. */
export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Текст ошибки для пользователя или null, если имя подходит. */
export function validateDisplayName(name: string): string | null {
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN) return `Имя короче ${DISPLAY_NAME_MIN} символов. Добавьте ещё немного.`;
  if (length > DISPLAY_NAME_MAX) return `Имя длиннее ${DISPLAY_NAME_MAX} символов. Сократите его.`;
  if (!NAME_RE.test(name)) {
    return 'Можно буквы, цифры, пробел, точку, дефис и подчёркивание. Начните и закончите буквой или цифрой.';
  }
  const lower = name.toLowerCase();
  if (RESERVED.some((word) => lower.includes(word))) {
    return 'Такое имя легко спутать с администрацией сайта. Выберите другое.';
  }
  return null;
}

/**
 * Подпись для того, кто имя ещё не задал. Почту показывать нельзя, а
 * одинаковое «Без имени» у всех делало бы комментарии разных людей
 * неразличимыми — поэтому хвост из id: он стабилен и никому ничего не
 * говорит.
 */
export function fallbackName(userId: string): string {
  return `Зритель ${userId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

export function nameOf(displayName: string | null | undefined, userId: string): string {
  return displayName && displayName.length > 0 ? displayName : fallbackName(userId);
}
