import { createClient } from '@/lib/supabase/server';
import { getAnimeCatalogFromIndex, getAnimeIndexByIds } from '@/lib/animeIndexQuery';
import { getCinemaCatalogFromIndex, getCinemaIndexByIds } from '@/lib/cinemaIndexQuery';
import { EMPTY_TRI } from '@/lib/catalogFilters';
import { getLocalBackdropIds, localBackdropUrl } from '@/lib/backdropCacheServer';
import type { ShikimoriAnimeShort } from '@/lib/shikimoriShared';
import type { CinemaShort } from '@/lib/videoseed-catalog';
import type { ContentType } from '@/lib/types';

/**
 * Чтение персональных рекомендаций и hero для главной (см. план редизайна).
 *
 * Список рекомендаций считает крон раз в сутки (api/cron/refresh-
 * recommendations, lib/recommendationsEngine.ts) — тот же крон докачивает
 * backdrop ВСЕГО списка. А вот КАКОЙ конкретно тайтл станет hero решается
 * прямо здесь, на каждом заходе на главную: getHeroPick случайно выбирает
 * один из уже закэшированных backdrop'ов пользователя — так hero меняется
 * при перезагрузке, а не залипает на весь день до следующего прогона крона.
 * Ничего не бросает: нет данных (новый пользователь, крон ещё не
 * прогонялся, гость) — тихий фоллбэк на популярное из локального индекса.
 */

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

/**
 * id тайтлов, которые пользователь уже как-то отметил (любой статус
 * user_list — запланировал, смотрит, бросил, посмотрел). Подборка
 * пересчитывается кроном раз в сутки и не знает про действия, случившиеся
 * ПОСЛЕ прогона — без этого фильтра тайтл, отмеченный «Просмотрено» через
 * «+» на карточке прямо в этом блоке, продолжал бы в нём висеть до
 * следующей ночи.
 */
async function getUserListIds(userId: string, contentType: ContentType): Promise<Set<number>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('user_list')
      .select('shikimori_id')
      .eq('user_id', userId)
      .eq('content_type', contentType);
    if (error || !data) return new Set();
    return new Set(data.map((r) => (r as { shikimori_id: number }).shikimori_id));
  } catch {
    return new Set();
  }
}

/** Персональные рекомендации аниме, готовые к AnimeCard. Гость/пустой набор
 *  от крона/крон ни разу не отработал — топ по популярности из anime_index. */
export async function getRecommendedAnime(userId: string | null): Promise<ShikimoriAnimeShort[]> {
  const excludeIds = userId ? await getUserListIds(userId, 'anime') : new Set<number>();
  const ids = userId ? await getRecommendedIds(userId, 'anime') : [];
  if (ids.length > 0) {
    const items = (await getAnimeIndexByIds(ids)).filter((a) => !excludeIds.has(a.id));
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
  return (fallback?.items ?? []).filter((a) => !excludeIds.has(a.id));
}

/** То же для кино, см. getRecommendedAnime. */
export async function getRecommendedCinema(userId: string | null): Promise<CinemaShort[]> {
  const excludeIds = userId ? await getUserListIds(userId, 'cinema') : new Set<number>();
  const ids = userId ? await getRecommendedIds(userId, 'cinema') : [];
  if (ids.length > 0) {
    const items = (await getCinemaIndexByIds(ids)).filter((c) => !excludeIds.has(c.id));
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
  return (fallback?.items ?? []).filter((c) => !excludeIds.has(c.id));
}

export interface HeroData {
  id: number;
  contentType: ContentType;
  title: string;
  description: string | null;
  year: number | null;
  rating: number | null;
  genres: string[];
  /** Всегда локальная ссылка (/backdrops/...) — getHeroPick выбирает только
   *  из уже скачанных кроном обложек (backdrop_cache), см. миграцию 0042.
   *  Рендер сам в Kitsu/TMDB никогда не ходит. */
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

/** Топ по популярности как id-список — фоллбэк-пул для гостя (тот же
 *  источник, что и у карточек, см. getRecommendedAnime/Cinema). */
async function getPopularIds(contentType: ContentType): Promise<number[]> {
  if (contentType === 'anime') {
    const page = await getAnimeCatalogFromIndex({
      genresInclude: [],
      genresExclude: [],
      sort: 'popularity',
      page: 1,
      pageSize: RECOMMENDED_LIMIT,
      excludeAnons: true,
    });
    return (page?.items ?? []).map((a) => a.id);
  }
  const page = await getCinemaCatalogFromIndex({
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
  return (page?.items ?? []).map((c) => c.id);
}

/**
 * Hero-тайтл для баннера главной. Выбирается случайно на каждом рендере из
 * (рекомендации пользователя, либо топ популярного для гостя) ∩ (что уже
 * реально скачано в backdrop_cache — крон кэширует backdrop всего списка,
 * см. lib/recommendationsEngine.ts). Никакого похода в Kitsu/TMDB отсюда
 * нет — только чтение уже готового реестра. Пустой пул (крон ещё не
 * прогонялся, у раздела совсем нет закэшированных обложек) — null,
 * вызывающий (page.tsx) просто не рендерит hero-баннер.
 */
export async function getHeroPick(
  userId: string | null,
  contentType: ContentType,
): Promise<HeroData | null> {
  try {
    const recommendedIds = userId ? await getRecommendedIds(userId, contentType) : [];
    const ids = recommendedIds.length > 0 ? recommendedIds : await getPopularIds(contentType);
    if (ids.length === 0) return null;

    const cachedIds = await getLocalBackdropIds(contentType, ids);
    const pool = ids.filter((id) => cachedIds.has(id));
    if (pool.length === 0) return null;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const detail =
      contentType === 'anime' ? await getAnimeHeroDetail(pick) : await getCinemaHeroDetail(pick);
    if (!detail || !detail.title) return null;

    return { ...detail, contentType, backdropUrl: localBackdropUrl(contentType, pick) };
  } catch {
    return null;
  }
}
