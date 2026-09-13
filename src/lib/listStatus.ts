import type { UserListStatus } from '@/lib/types';

/**
 * Статусы пользовательского списка — одна таблица на весь сайт: кнопка на
 * странице тайтла, вкладки в профиле и чужой список на странице человека.
 * Раньше подписи жили копиями в каждом компоненте, и новый статус пришлось бы
 * добавлять в трёх местах, забыв одно.
 *
 * Порядок — порядок показа: сначала то, что смотрится сейчас.
 */
export const LIST_STATUS_OPTIONS: { value: UserListStatus; label: string }[] = [
  { value: 'watching', label: 'Смотрю' },
  { value: 'rewatching', label: 'Пересматриваю' },
  { value: 'planned', label: 'В планах' },
  { value: 'completed', label: 'Просмотрено' },
  { value: 'dropped', label: 'Брошено' },
];

export const LIST_STATUS_LABELS = Object.fromEntries(
  LIST_STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<UserListStatus, string>;
