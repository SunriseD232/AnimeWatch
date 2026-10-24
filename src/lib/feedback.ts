/**
 * Обратная связь с администратором (миграция 0066) — общее для сервера и
 * браузера: разделы, типы переписки, ссылки. Серверная часть —
 * lib/feedbackServer.ts, API — /api/feedback.
 */

export const FEEDBACK_SECTIONS = [
  { value: 'audiobooks', label: 'Аудиокниги' },
  { value: 'podcasts', label: 'Подкасты' },
  { value: 'books', label: 'Книги' },
  { value: 'ranobe', label: 'Ранобэ' },
  { value: 'manga', label: 'Манга' },
  { value: 'anime', label: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы' },
  { value: 'site', label: 'Сайт в целом' },
  { value: 'other', label: 'Другое' },
] as const;

export type FeedbackSection = (typeof FEEDBACK_SECTIONS)[number]['value'];

export function isFeedbackSection(value: unknown): value is FeedbackSection {
  return FEEDBACK_SECTIONS.some((s) => s.value === value);
}

export function feedbackSectionLabel(section: string): string {
  return FEEDBACK_SECTIONS.find((s) => s.value === section)?.label ?? 'Другое';
}

/** Сообщение не длиннее — как в CHECK таблицы. */
export const FEEDBACK_MAX_LENGTH = 4000;

export interface FeedbackMessageView {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: string;
}

export interface FeedbackThreadView {
  id: string;
  section: string;
  status: 'open' | 'closed';
  createdAt: string;
  lastMessageAt: string;
  /** Есть непрочитанное для того, кто смотрит (человек или админ). */
  unread: boolean;
  /** Кто написал — только в ящике админа. */
  author: { id: string; name: string; email: string | null } | null;
  messages: FeedbackMessageView[];
}

/** Куда ведёт уведомление: человеку — его переписка, админу — ящик. */
export function feedbackHref(threadId: string, forAdmin: boolean): string {
  return `/profile?tab=${forAdmin ? 'inbox' : 'feedback'}&thread=${threadId}`;
}
