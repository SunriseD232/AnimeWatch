import { createClient } from '@/lib/supabase/server';
import { getAnimeCatalogFromIndex, getAnimeIndexByIds } from '@/lib/animeIndexQuery';
import { getCinemaCatalogFromIndex, getCinemaIndexByIds } from '@/lib/cinemaIndexQuery';
import { EMPTY_TRI } from '@/lib/catalogFilters';
import type { ShikimoriAnimeShort } from '@/lib/shikimoriShared';
import type { CinemaShort } from '@/lib/videoseed-catalog';
import type { ContentType } from '@/lib/types';

/**
 * Чтение персональных рекомендаций и hero для главной (см. план редизайна).
 *
 * Всё здесь ТОЛЬКО читает — подбор считает крон раз в сутки
 * (api/cron/refresh-recommendations, lib/recommendationsEngine.ts). Ничего
 * не бросает: нет строк (новый пользователь, крон ещё не прогонялся, гость)
 * — тихий фоллбэк на популярное из локального индекса, страница не должна
 * из-за этого падать или показывать ошибку.
 */

/** Гостевой sentinel в hero_pick — см. миграцию 0041. NULL user_id ломал бы
 *  идемпотентность upsert по PK (NULL никогда не равен NULL), поэтому у
 *  гостя обычная строка с фиксированным id, а не отсутствие user_id. */
export const GUEST_HERO_USER_ID = '00000000-0000-0000-0000-000000000000';

const RECOMMENDED_LIMIT = 12;

async function getRecommendedIds(userId: string, contentType: ContentType): Promise<number[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('user_recommendations')
      .select('item_id')
      .eq('user_id', userId)
      .eq('content_type', contentType)
      .order('rank', { ascending: true })
      .limit(RECOMMENDED_LIMIT);
    if (error || !data) return [];
    return data.map((r) => (r as { item_id: number }).item_id);
  } catch {
    return [];
  }
}

/** Персональные рекомендации аниме, готовые к AnimeCard. Гость/пустой набор
 *  от крона/крон ни разу не отработал — топ по популярности из anime_index. */
export async function getRecommendedAnime(userId: string | null): Promise<ShikimoriAnimeShort[]> {
  const ids = userId ? await getRecommendedIds(userId, 'anime') : [];
  if (ids.length > 0) {
    const items = await getAnimeIndexByIds(ids);
    if (items.length > 0) return items;
  }
  const fallback = await getAnimeCatalogFromIndex({
    genresInclude: [],
    genresExclude: [],
    sort: 'popularity',
    page: 1,
    pageSize: RECOMMENDED_LIMIT,
    excludeAnons: true,
  });
  return fallback?.items ?? [];
}

/** То же для кино, см. getRecommendedAnime. */
export async function getRecommendedCinema(userId: string | null): Promise<CinemaShort[]> {
  const ids = userId ? await getRecommendedIds(userId, 'cinema') : [];
  if (ids.length > 0) {
    const items = await getCinemaIndexByIds(ids);
    if (items.length > 0) return items;
  }
  const fallback = await getCinemaCatalogFromIndex({
    genresInclude: [],
    genresExclude: [],
    countriesInclude: [],
    countriesExclude: [],
    kinds: EMPTY_TRI,
    yearFrom: null,
    yearTo: null,
    sort: 'popularity',
    page: 1,
    pageSize: RECOMMENDED_LIMIT,
  });
  return fallback?.items ?? [];
}

export interface HeroData {
  id: number;
  contentType: ContentType;
  title: string;
  description: string | null;
  year: number | null;
  rating: number | null;
  genres: string[];
  /** Уже полностью разрешённая ссылка — локальный кэш либо апстрим, считает
   *  крон заранее (см. hero_pick в миграции 0041). Рендер сам в Kitsu/TMDB
   *  никогда не ходит. */
  backdropUrl: string;
}

async function getAnimeHeroDetail(
  id: number,
): Promise<Omit<HeroData, 'contentType' | 'backdropUrl'> | null> {
  try {
    const supabase = createClient();
    const { data: state } = await supabase
      .from('anime_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    const batchId = state?.active_batch as string | undefined;
    if (!batchId) return null;

    const { data, error } = await supabase
      .from('anime_index')
      .select('shikimori_id, russian, name, description, aired_year, score, genre_ids')
      .eq('batch_id', batchId)
      .eq('shikimori_id', id)
      .maybeSingle();
    if (error || !data) return null;

    const genreIds = ((data.genre_ids as number[] | null) ?? []).slice(0, 4);
    let genres: string[] = [];
    if (genreIds.length > 0) {
      const { data: names } = await supabase
        .from('anime_genres')
        .select('id, russian')
        .in('id', genreIds);
      const byId = new Map((names ?? []).map((g) => [g.id as number, g.russian as string]));
      genres = genreIds.map((gid) => byId.get(gid)).filter((x): x is string => Boolean(x));
    }

    return {
      id,
      title: (data.russian as string | null) || (data.name as string | null) || '',
      description: data.description as string | null,
      year: data.aired_year as number | null,
      rating: data.score !== null ? Number(data.score) : null,
      genres,
    };
  } catch {
    return null;
  }
}

async function getCinemaHeroDetail(
  id: number,
): Promise<Omit<HeroData, 'contentType' | 'backdropUrl'> | null> {
  try {
    const supabase = createClient();
    const { data: state } = await supabase
      .from('cinema_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    const batchId = state?.active_batch as string | undefined;
    if (!batchId) return null;

    const { data, error } = await supabase
      .from('cinema_index')
      .select('kp_id, title, original_title, description, year, rating, genre_ids')
      .eq('batch_id', batchId)
      .eq('kp_id', id)
      .maybeSingle();
    if (error || !data) return null;

    const genreIds = ((data.genre_ids as number[] | null) ?? []).slice(0, 4);
    let genres: string[] = [];
    if (genreIds.length > 0) {
      const { data: names } = await supabase
        .from('cinema_genres')
        .select('id, name')
        .eq('kind', 'genre')
        .in('id', genreIds);
      const byId = new Map((names ?? []).map((g) => [g.id as number, g.name as string]));
      genres = genreIds.map((gid) => byId.get(gid)).filter((x): x is string => Boolean(x));
    }

    return {
      id,
      title: (data.title as string | null) || (data.original_title as string | null) || '',
      description: data.description as string | null,
      year: data.year as number | null,
      rating: data.rating !== null ? Number(data.rating) : null,
      genres,
    };
  } catch {
    return null;
  }
}

/**
 * Hero-тайтл для баннера главной. userId=null — гость, читает общий
 * sentinel-pick (GUEST_HERO_USER_ID), тот же для всех гостей раздела.
 * null — ни разу не считалось (крон ещё не прогонялся) — вызывающий
 * (page.tsx) в этом случае просто не рендерит hero-баннер.
 */
export async function getHeroPick(
  userId: string | null,
  contentType: ContentType,
): Promise<HeroData | null> {
  const pickUserId = userId ?? GUEST_HERO_USER_ID;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('hero_pick')
      .select('item_id, backdrop_url')
      .eq('user_id', pickUserId)
      .eq('content_type', contentType)
      .maybeSingle();
    if (error || !data || !data.backdrop_url) return null;

    const itemId = data.item_id as number;
    const detail =
      contentType === 'anime'
        ? await getAnimeHeroDetail(itemId)
        : await getCinemaHeroDetail(itemId);
    if (!detail || !detail.title) return null;

    return { ...detail, contentType, backdropUrl: data.backdrop_url as string };
  } catch {
    return null;
  }
}
