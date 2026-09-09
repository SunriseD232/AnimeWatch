/**
 * Мелочи Shikimori, которые нужны и серверу, и браузеру: форма краткой
 * карточки, сборка абсолютной ссылки на картинку и «сколько серий показать».
 *
 * Вынесены из lib/shikimori.ts, потому что тот ходит в сеть и в базу, а
 * карточка каталога — клиентский компонент. Пока она импортировала их прямо
 * оттуда, в клиентский бандл ехал весь модуль целиком; в тот день, когда в
 * нём появился запрос к Supabase, сборка упала с webpack-ошибкой на
 * next/headers. Здесь зависимостей нет вовсе — и не должно появиться.
 */

const BASE_URL = 'https://shikimori.io';

export interface ShikimoriAnimeShort {
  id: number;
  name: string;
  russian: string;
  image: {
    original: string;
    preview: string;
    x96: string;
    x48: string;
  };
  url: string;
  kind: string | null;
  score: string;
  status: string;
  episodes: number;
  episodes_aired: number;
  aired_on: string | null;
  released_on: string | null;
  /** Заполняется только локальным индексом (см. lib/animeIndexQuery.ts) —
   *  REST-ответы Shikimori описания в списках не содержат. Нужно списочному
   *  виду каталога. */
  description?: string | null;
  /** Обложка с нашего диска, если она туда уже скачана (см. миграцию 0029).
   *  Карточка пробует её первой, а ссылки выше остаются запасными — файла
   *  может не быть у только что появившегося тайтла. */
  localPoster?: string | null;
}

export function imageUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path}`;
}

export function episodeCount(anime: {
  episodes: number;
  episodes_aired: number;
  status: string;
}): number {
  if (anime.status === 'ongoing' && anime.episodes_aired > 0) {
    return anime.episodes_aired;
  }
  if (anime.episodes > 0) return anime.episodes;
  return anime.episodes_aired > 0 ? anime.episodes_aired : 1;
}
