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

const VIBIX_API = 'https://vibix.org/api/v1';

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
  if (!token) return null;
  try {
    const res = await fetch(
      `${VIBIX_API}/publisher/videos/kp/${kinopoiskId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        next: { revalidate: 600 },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { embed_code?: string };
    return parseEmbedCode(data.embed_code);
  } catch {
    return null;
  }
}
