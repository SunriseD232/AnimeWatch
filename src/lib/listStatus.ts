import type { ContentType, UserListStatus } from '@/lib/types';

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

/**
 * Подписи статусов по типу контента. Значения статусов общие (constraint
 * user_list_status_check), меняются только слова: книгу не «смотрят», а
 * подкаст не «читают».
 */
const READ_LABELS: Record<UserListStatus, string> = {
  watching: 'Читаю',
  rewatching: 'Перечитываю',
  planned: 'В планах',
  completed: 'Прочитано',
  dropped: 'Брошено',
};

const LISTEN_LABELS: Record<UserListStatus, string> = {
  watching: 'Слушаю',
  rewatching: 'Переслушиваю',
  planned: 'В планах',
  completed: 'Прослушано',
  dropped: 'Брошено',
};

function labelsFor(type: ContentType): Record<UserListStatus, string> {
  if (type === 'book' || type === 'manga' || type === 'ranobe') return READ_LABELS;
  if (type === 'podcast') return LISTEN_LABELS;
  return LIST_STATUS_LABELS;
}

export function listStatusOptions(type: ContentType): { value: UserListStatus; label: string }[] {
  const labels = labelsFor(type);
  return LIST_STATUS_OPTIONS.map((o) => ({ value: o.value, label: labels[o.value] }));
}

export function listStatusLabel(type: ContentType, status: UserListStatus): string {
  return labelsFor(type)[status] ?? status;
}

/** Подпись выключателя уведомлений; null — у типа их не бывает (книга). */
export function listMuteLabel(type: ContentType, muted: boolean): string | null {
  const unit =
    type === 'manga' || type === 'ranobe'
      ? 'главах'
      : type === 'podcast'
        ? 'выпусках'
        : type === 'book'
          ? null
          : 'сериях';
  if (!unit) return null;
  return muted ? 'Включить уведомления' : `Не уведомлять о ${unit}`;
}
