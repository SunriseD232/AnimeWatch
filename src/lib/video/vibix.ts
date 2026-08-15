/**
 * Vibix — третий балансер раздела «Фильмы и сериалы».
 *
 * Ключевое преимущество: его плеер (Playerjs с ВКЛЮЧЁННЫМ postMessage-мостом)
 * шлёт родительскому окну события `{type:'playerEvent', event, time, duration}`
 * и принимает команды `{type:'playerCommand', command:'seek'|..., value}` —
 * т.е. даёт ТОЧНЫЙ трекинг позиции просмотра, недоступный у Videoseed.
 *
 * Интеграция по официальной инструкции кабинета: REST API с Bearer-токеном
 * отдаёт `embed_code` (атрибуты для тега <ins>), сам плеер создаёт их SDK
 * https://graphicslab.io/sdk/v2/rendex-sdk.min.js (см. VibixPlayer.tsx).
 *
 * Модуль читает env — исполняется ТОЛЬКО на сервере (Bearer-токен приватный,
 * в отличие от публичных embed-токенов Videoseed/Kodik).
 */

import { getCachedJson } from '@/lib/cache/apiCache';

const VIBIX_API = 'https://vibix.org/api/v1';
// См. VS_FETCH_TIMEOUT_MS в videoseed-catalog.ts — без таймаута зависший
// апстрим вешает страницу тайтла/просмотра целиком.
const VIBIX_FETCH_TIMEOUT_MS = 8_000;

export interface VibixEmbed {
  /** Publisher ID аккаунта (публичный, из embed_code). */
  publisherId: string;
  /** Значение data-type из embed_code (movie | serial | ...). */
  type: string;
  /** Внутренний ID контента Vibix (data-id). */
  id: string;
}

/** Разбирает строку embed_code вида data-publisher-id="..." data-type="..." data-id="...". */
function parseEmbedCode(code: string | undefined): VibixEmbed | null {
  if (!code) return null;
  const attr = (name: string) =>
    code.match(new RegExp(`data-${name}="([^"]+)"`))?.[1];
  const publisherId = attr('publisher-id');
  const type = attr('type');
  const id = attr('id');
  if (!publisherId || !type || !id) return null;
  return { publisherId, type, id };
}

/**
 * Данные для встройки плеера Vibix по kinopoisk_id.
 * null — нет токена, тайтла нет в каталоге Vibix (404) или API недоступен.
 */
export async function getVibixEmbed(
  kinopoiskId: number,
): Promise<VibixEmbed | null> {
  const token = process.env.VIBIX_TOKEN;
  if (!token) {
    console.warn('[vibix] VIBIX_TOKEN не задан — плеер Vibix отключён');
    return null;
  }
  try {
    return await getCachedJson(`vibix:kp:${kinopoiskId}`, 600, async () => {
      const res = await fetch(
        `${VIBIX_API}/publisher/videos/kp/${kinopoiskId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(VIBIX_FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        // 404 — тайтла нет в каталоге (норма, кэшируем и это); остальное —
        // проблемы токена/API, не кэшируем (пусть повторит на следующий запрос).
        if (res.status === 404) return null;
        throw new Error(`[vibix] API ${res.status} для kp=${kinopoiskId}`);
      }
      const data = (await res.json()) as { embed_code?: string };
      const embed = parseEmbedCode(data.embed_code);
      if (!embed) {
        console.warn(
          `[vibix] не удалось разобрать embed_code для kp=${kinopoiskId}:`,
          data.embed_code,
        );
      }
      return embed;
    });
  } catch (err) {
    console.warn('[vibix] ошибка запроса:', err);
    return null;
  }
}
