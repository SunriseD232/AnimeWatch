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
 * прямо здесь, на каждом заходе на главную: getHeroPicks берёт всю подборку,
 * у которой уже есть скачанный backdrop, и баннер листает её сам (слайды
 * переключаются вручную и автоматически раз в 10 секунд).
 * Ничего не бросает: нет данных (новый пользователь, крон ещё не
 * прогонялся, гость) — тихий фоллбэк на популярное из локального индекса.
 */

const RECOMMENDED_LIMIT = 12;

/**
 * Сколько слайдов держим в hero-карусели. Десять — это сто секунд полного
 * круга при автопереключении раз в 10 секунд; больше полосок прогресса в ряд
 * на телефоне уже не умещается так, чтобы по ним можно было попасть пальцем
 * (WCAG 2.5.8 — цель не меньше 24 пикселей).
 */
const HERO_LIMIT = 10;

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
 * id тайтлов, которых в рекомендациях быть не должно.
 *
 * ПРАВИЛО: рекомендуем только то, что человек ПЛАНИРУЕТ смотреть или чего в
 * его списке нет вовсе. Всё остальное — посмотрел, смотрит, пересматривает,
 * бросил — из подборки убираем: советовать «Во все тяжкие» тому, кто его
 * досмотрел, бессмысленно. Запланированное, наоборот, оставляем намеренно —
 * это как раз напоминание «ты хотел, вот оно».
 *
 * Начатое считается по watch_progress, а не только по статусу: человек мог
 * смотреть, не отмечая тайтл в списке, и статуса у него нет вообще.
 *
 * Фильтр нужен и на чтении, а не только в кроне: подборка пересчитывается
 * раз в сутки и не знает про действия ПОСЛЕ прогона — без него тайтл,
 * отмеченный «Просмотрено» через «+» прямо в этом блоке, висел бы в нём до
 * следующей ночи.
 */
async function getExcludedIds(userId: string, contentType: ContentType): Promise<Set<number>> {
  try {
    const supabase = createClient();
    const [{ data: listRows, error: listError }, { data: progressRows }] = await Promise.all([
      supabase
        .from('user_list')
        .select('shikimori_id, status')
        .eq('user_id', userId)
        .eq('content_type', contentType)
        .neq('status', 'planned'),
      supabase
        .from('watch_progress')
        .select('shikimori_id')
        .eq('user_id', userId)
        .eq('content_type', contentType),
    ]);
    if (listError) return new Set();
    const out = new Set<number>();
    for (const r of listRows ?? []) out.add((r as { shikimori_id: number }).shikimori_id);
    for (const r of progressRows ?? []) out.add((r as { shikimori_id: number }).shikimori_id);
    return out;
  } catch {
    return new Set();
  }
}

/** Персональные рекомендации аниме, готовые к AnimeCard. Гость/пустой набор
 *  от крона/крон ни разу не отработал — топ по популярности из anime_index. */
export async function getRecommendedAnime(userId: string | null): Promise<ShikimoriAnimeShort[]> {
  const excludeIds = userId ? await getExcludedIds(userId, 'anime') : new Set<number>();
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
  const excludeIds = userId ? await getExcludedIds(userId, 'cinema') : new Set<number>();
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
  /** Всегда локальная ссылка (/backdrops/...) — getHeroPicks берёт только
   *  уже скачанные кроном обложки (backdrop_cache), см. миграцию 0042.
   *  Рендер сам в Kitsu/TMDB никогда не ходит. */
  backdropUrl: string;
}

/**
 * Детали сразу для СПИСКА id — hero на главной теперь не один тайтл, а
 * карусель по всей подборке (см. getHeroPicks), и прежние «две выборки на
 * тайтл» превратились бы в двадцать с лишним запросов на каждый заход.
 * Порядок результата — как в переданном списке; чего нет в индексе, тихо
 * выпадает.
 */
async function getAnimeHeroDetails(
  ids: number[],
): Promise<Map<number, Omit<HeroData, 'contentType' | 'backdropUrl'>>> {
  const out = new Map<number, Omit<HeroData, 'contentType' | 'backdropUrl'>>();
  if (ids.length === 0) return out;
  try {
    const supabase = createClient();
    const { data: state } = await supabase
      .from('anime_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    const batchId = state?.active_batch as string | undefined;
    if (!batchId) return out;

    const { data, error } = await supabase
      .from('anime_index')
      .select('shikimori_id, russian, name, description, aired_year, score, genre_ids')
      .eq('batch_id', batchId)
      .in('shikimori_id', ids);
    if (error || !data) return out;

    // Названия жанров — одним запросом на всю пачку, а не по тайтлу.
    const allGenreIds = [
      ...new Set(data.flatMap((r) => ((r.genre_ids as number[] | null) ?? []).slice(0, 4))),
    ];
    const names = new Map<number, string>();
    if (allGenreIds.length > 0) {
      const { data: genreRows } = await supabase
        .from('anime_genres')
        .select('id, russian')
        .in('id', allGenreIds);
      for (const g of genreRows ?? []) names.set(g.id as number, g.russian as string);
    }

    for (const row of data) {
      const id = row.shikimori_id as number;
      const genres = ((row.genre_ids as number[] | null) ?? [])
        .slice(0, 4)
        .map((gid) => names.get(gid))
        .filter((x): x is string => Boolean(x));
      out.set(id, {
        id,
        title: (row.russian as string | null) || (row.name as string | null) || '',
        description: row.description as string | null,
        year: row.aired_year as number | null,
        rating: row.score !== null ? Number(row.score) : null,
        genres,
      });
    }
    return out;
  } catch {
    return out;
  }
}

/** То же для кино, см. getAnimeHeroDetails. */
async function getCinemaHeroDetails(
  ids: number[],
): Promise<Map<number, Omit<HeroData, 'contentType' | 'backdropUrl'>>> {
  const out = new Map<number, Omit<HeroData, 'contentType' | 'backdropUrl'>>();
  if (ids.length === 0) return out;
  try {
    const supabase = createClient();
    const { data: state } = await supabase
      .from('cinema_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    const batchId = state?.active_batch as string | undefined;
    if (!batchId) return out;

    const { data, error } = await supabase
      .from('cinema_index')
      .select('kp_id, title, original_title, description, year, rating, genre_ids')
      .eq('batch_id', batchId)
      .in('kp_id', ids);
    if (error || !data) return out;

    const allGenreIds = [
      ...new Set(data.flatMap((r) => ((r.genre_ids as number[] | null) ?? []).slice(0, 4))),
    ];
    const names = new Map<number, string>();
    if (allGenreIds.length > 0) {
      const { data: genreRows } = await supabase
        .from('cinema_genres')
        .select('id, name')
        // kind='genre' — маркеры типа (Сериалы=20, Мультфильмы=21) в подписи
        // hero не нужны, они дублируют сам раздел сайта.
        .eq('kind', 'genre')
        .in('id', allGenreIds);
      for (const g of genreRows ?? []) names.set(g.id as number, g.name as string);
    }

    for (const row of data) {
      const id = row.kp_id as number;
      const genres = ((row.genre_ids as number[] | null) ?? [])
        .slice(0, 4)
        .map((gid) => names.get(gid))
        .filter((x): x is string => Boolean(x));
      out.set(id, {
        id,
        title: (row.title as string | null) || (row.original_title as string | null) || '',
        description: row.description as string | null,
        year: row.year as number | null,
        rating: row.rating !== null ? Number(row.rating) : null,
        genres,
      });
    }
    return out;
  } catch {
    return out;
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
 * Тайтлы для hero-карусели главной, в порядке подборки (лучшее первым).
 *
 * Пул — (рекомендации пользователя, либо топ популярного для гостя) ∩ (что
 * уже реально скачано в backdrop_cache; крон кэширует backdrop ВСЕГО списка,
 * см. lib/recommendationsEngine.ts). Никакого похода в Kitsu/TMDB отсюда нет
 * — только чтение готового реестра.
 *
 * РАНЬШЕ здесь выбирался ОДИН тайтл, случайно на каждом рендере: так hero
 * менялся при перезагрузке и не залипал на весь день. Теперь вся подборка
 * переехала в сам баннер (слайды переключаются вручную и сами каждые 10
 * секунд), и случайность больше не нужна — порядок честно идёт от лучшего
 * совпадения к худшему.
 *
 * Пустой массив (крон ещё не прогонялся, обложки не скачаны) — законное
 * состояние: вызывающий просто не рендерит баннер.
 */
export async function getHeroPicks(
  userId: string | null,
  contentType: ContentType,
): Promise<HeroData[]> {
  try {
    const recommendedIds = userId ? await getRecommendedIds(userId, contentType) : [];
    const excludeIds = userId ? await getExcludedIds(userId, contentType) : new Set<number>();
    const source = recommendedIds.length > 0 ? recommendedIds : await getPopularIds(contentType);
    const ids = source.filter((id) => !excludeIds.has(id));
    if (ids.length === 0) return [];

    const cachedIds = await getLocalBackdropIds(contentType, ids);
    // Без скачанного backdrop слайда нет: постер — портретный, в широком
    // баннере он растянулся бы или обрезался до неузнаваемости.
    const pool = ids.filter((id) => cachedIds.has(id)).slice(0, HERO_LIMIT);
    if (pool.length === 0) return [];

    const details =
      contentType === 'anime'
        ? await getAnimeHeroDetails(pool)
        : await getCinemaHeroDetails(pool);

    return pool
      .map((id) => details.get(id))
      .filter((d): d is Omit<HeroData, 'contentType' | 'backdropUrl'> => Boolean(d?.title))
      .map((d) => ({ ...d, contentType, backdropUrl: localBackdropUrl(contentType, d.id) }));
  } catch {
    return [];
  }
}
