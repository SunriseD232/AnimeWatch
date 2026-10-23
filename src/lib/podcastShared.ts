/**
 * Мелочи подкастов, которые нужны и серверу, и браузеру: типы карточки и
 * эпизода, список регионов и код страны в подписи.
 *
 * Вынесены из lib/podcasts.ts по той же причине, что и shikimoriShared:
 * карточка подкаста (components/podcasts/PodcastCard) и строка поиска —
 * клиентские компоненты, а lib/podcasts.ts ходит в сеть и в базу. Пока они
 * импортировали константы прямо оттуда, в клиентский бандл ехал весь модуль
 * целиком, и сборка падала с webpack-ошибкой на next/headers.
 *
 * Здесь зависимостей нет вовсе — и не должно появиться.
 */

/** Карточка подкаста — то, что нужно сетке и карточке. */
export interface PodcastSummary {
  /** Apple collectionId; он же уходит в shikimori_id прогресса. */
  id: number;
  title: string;
  author: string;
  artworkUrl: string | null;
  genre: string | null;
  /** ISO-код страны каталога ('us', 'ru', …). null — источник его не дал. */
  country: string | null;
  /** Код языка фида ('ru', 'en', …) — из RSS language или iTunes. */
  language: string | null;
  episodeCount: number | null;
}

export interface PodcastEpisode {
  /** Порядковый номер в фиде (хронология, 1 — самый старый). Стабилен: новые
   *  эпизоды дописываются в конец и старые номера не сдвигают. Именно он
   *  уходит в watch_progress.episode — Apple trackId бывает больше int32. */
  index: number;
  title: string;
  description: string | null;
  /** Прямая ссылка на аудиофайл из <enclosure>. */
  audioUrl: string;
  durationSeconds: number;
  imageUrl: string | null;
  publishedAt: string | null;
  guid: string | null;
}

export interface PodcastDetails extends PodcastSummary {
  description: string | null;
  feedUrl: string;
  /** Ссылка на страницу в Apple Podcasts — на случай, если хочется открыть
   *  в приложении/браузере у первоисточника. */
  appleUrl: string | null;
  episodes: PodcastEpisode[];
  /** true — фид взять не удалось; эпизоды пусты. Страница покажет это явно,
   *  а не сделает вид, что у подкаста нет выпусков. */
  episodesUnavailable: boolean;
}

export const PODCAST_REGIONS = [
  { code: 'us', label: 'США' },
  { code: 'gb', label: 'Великобритания' },
  { code: 'de', label: 'Германия' },
  { code: 'fr', label: 'Франция' },
  { code: 'es', label: 'Испания' },
  { code: 'it', label: 'Италия' },
  { code: 'ru', label: 'Россия' },
  { code: 'ua', label: 'Украина' },
  { code: 'pl', label: 'Польша' },
  { code: 'nl', label: 'Нидерланды' },
  { code: 'se', label: 'Швеция' },
  { code: 'jp', label: 'Япония' },
  { code: 'kr', label: 'Корея' },
  { code: 'cn', label: 'Китай' },
  { code: 'in', label: 'Индия' },
  { code: 'br', label: 'Бразилия' },
  { code: 'mx', label: 'Мексика' },
  { code: 'au', label: 'Австралия' },
  { code: 'ca', label: 'Канада' },
] as const;

export type PodcastRegion = (typeof PODCAST_REGIONS)[number]['code'];

export const DEFAULT_PODCAST_REGION: PodcastRegion = 'us';

/**
 * Кука выбранного региона. Регион влияет на живой поиск в iTunes (там он
 * обязателен), поэтому выбор запоминаем — иначе на каждом заходе человек
 * снова попадал бы в каталог США, даже если ищет русскоязычное.
 *
 * В адресе региона первичен: ссылку на конкретный поиск можно переслать, а
 * куку — нет (см. чтение в /podcasts/page.tsx). Кука тут только «что было в
 * прошлый раз».
 */
export const PODCAST_REGION_COOKIE = 'aw_podcast_region';

export function normalizeRegion(value: string | null | undefined): PodcastRegion | null {
  if (!value) return null;
  const code = value.toLowerCase();
  return PODCAST_REGIONS.some((r) => r.code === code) ? (code as PodcastRegion) : null;
}

export function regionLabel(code: string | null): string | null {
  if (!code) return null;
  return PODCAST_REGIONS.find((r) => r.code === code)?.label ?? code.toUpperCase();
}
