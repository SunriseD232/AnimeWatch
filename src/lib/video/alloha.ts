import { allohaDispatcher } from '@/lib/net/allohaProxy';
import type { OwnPlayerTranslation } from '@/lib/extract/types';

/**
 * Официальный API Alloha (в отличие от анимного пути через Yummy, см.
 * lib/video/yummy.ts, — здесь прямой платный доступ по токену и по
 * kinopoisk_id, работает и для кино). Проверено вживую: даёт список озвучек
 * с embed-ссылками и флагом uhd (реально есть 4K-варианты для части раздач).
 *
 * Гео-заблокирована — без RU-прокси (см. lib/net/allohaProxy.ts) даже сам
 * API-запрос с валидным токеном не проходит.
 *
 * "ONLY FOR PERSONAL USE" — токены создаются самостоятельно, несколько
 * штук про запас (не все могут быть активны сразу), поэтому пробуем по
 * очереди и останавливаемся на первом, который реально отвечает "success".
 */
const ALLOHA_API = 'https://api.alloha.tv/';
const ALLOHA_TIMEOUT_MS = 10_000;

function tokens(): string[] {
  return [process.env.ALLOHA_TOKEN, process.env.ALLOHA_TOKEN_2].filter(
    (t): t is string => !!t,
  );
}

interface AllohaTranslationEntry {
  name?: string;
  iframe?: string;
  quality?: string;
  uhd?: boolean;
}

interface AllohaResponse {
  status?: string;
  data?: {
    iframe?: string;
    translation_iframe?: Record<string, AllohaTranslationEntry>;
  };
}

async function fetchWithToken(kinopoiskId: number, token: string): Promise<AllohaResponse | null> {
  try {
    const res = await fetch(`${ALLOHA_API}?token=${token}&kp=${kinopoiskId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ALLOHA_TIMEOUT_MS),
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: allohaDispatcher(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AllohaResponse;
    return data.status === 'success' ? data : null;
  } catch {
    return null;
  }
}

/** Пробует токены по очереди, останавливается на первом рабочем. */
async function fetchAlloha(kinopoiskId: number): Promise<AllohaResponse | null> {
  for (const token of tokens()) {
    const data = await fetchWithToken(kinopoiskId, token);
    if (data) return data;
  }
  return null;
}

// Id озвучки в общем плоском списке «Наш плеер» (Kodik + Videoseed + Alloha +
// Real-Debrid, см. resolveCinemaEpisode.ts) должен быть уникален среди ВСЕХ
// источников сразу — активный перевод там ищется одним .find(t => t.id ===
// translationId) по всему списку без учёта source. Id из Alloha — их
// собственные небольшие числа (в духе Kodik: 63, 66, 93, 154...) — вполне
// могут совпасть с Kodik. Смещаем в заведомо свободный диапазон.
const ID_OFFSET = 1_000_000;

/**
 * Список озвучек фильма/сериала для селектора «Наш плеер» — по kinopoisk_id.
 * embedUrl уже готов к передаче в extractViaVps (source: 'alloha') так же,
 * как embed Yummy для аниме, см. lib/extract/resolve.ts.
 */
export async function getAllohaOwnPlayerTranslations(
  kinopoiskId: number,
): Promise<OwnPlayerTranslation[]> {
  if (tokens().length === 0) return [];
  const data = await fetchAlloha(kinopoiskId);
  const entries = Object.entries(data?.data?.translation_iframe ?? {});
  if (entries.length === 0) return [];

  return entries
    .filter((entry): entry is [string, AllohaTranslationEntry & { iframe: string }] => !!entry[1].iframe)
    .map(([id, t]) => ({
      id: ID_OFFSET + Number(id),
      title: t.uhd ? `${t.name ?? 'Озвучка'} · 4K` : t.name ?? 'Озвучка',
      embedUrl: t.iframe,
      source: 'alloha' as const,
    }));
}
