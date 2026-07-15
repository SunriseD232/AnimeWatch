/**
 * Источник видео на базе Videoseed (tv-*-kinoserial.net).
 *
 * Основной плеер раздела «Фильмы и сериалы». В отличие от Kodik, embed здесь
 * строится напрямую по внешнему id (kinopoisk / imdb / tmdb) через endpoint
 * `embed_auto`, который сам определяет тип контента (фильм/сезон/сериал).
 *
 * ВАЖНО: токен Videoseed по дизайну провайдера передаётся прямо в src iframe и
 * виден в браузере — это публичный embed-токен (аналогично тому, как это описано
 * в официальной инструкции). Поэтому URL строим на сервере (env без NEXT_PUBLIC),
 * но сам результат с токеном отдаётся клиенту — это нормально и неизбежно.
 *
 * Модуль читает env, поэтому вызывается ТОЛЬКО на сервере.
 */

// Домен привязан к аккаунту Videoseed (виден в «Шаблоне embed-кода» в кабинете).
// По умолчанию tv-1-kinoserial.net; можно переопределить через VIDEOSEED_HOST.
function videoseedHost(): string {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

export interface VideoseedParams {
  /** Kinopoisk ID — основной идентификатор раздела кино. */
  kinopoiskId?: number;
  /** IMDB ID (tt...) — запасной идентификатор. */
  imdbId?: string;
  /** TMDB ID — запасной идентификатор (передаётся с префиксом tmdb). */
  tmdbId?: number | string;
  /** Номер сезона (для сериалов). По умолчанию 1. */
  season?: number;
  /** Номер серии (для сериалов). */
  episode?: number;
  /** Является ли тайтл сериалом (тогда добавляем выбор сезона/серии). */
  isSerial?: boolean;
  /** Стартовая позиция в секундах для восстановления просмотра. */
  startFrom?: number;
}

/** Собирает ID для embed_auto из доступных внешних идентификаторов. */
function resolveId(params: VideoseedParams): string | null {
  if (params.kinopoiskId != null && Number.isFinite(params.kinopoiskId)) {
    return String(params.kinopoiskId);
  }
  if (params.imdbId) return params.imdbId;
  if (params.tmdbId != null && params.tmdbId !== '') {
    const raw = String(params.tmdbId);
    return raw.startsWith('tmdb') ? raw : `tmdb${raw}`;
  }
  return null;
}

/**
 * Строит URL плеера Videoseed или возвращает null, если нет токена/идентификатора.
 */
export function buildVideoseedEmbedUrl(
  params: VideoseedParams,
): string | null {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) return null;

  const id = resolveId(params);
  if (!id) return null;

  const url = new URL(`https://${videoseedHost()}/embed_auto/${id}/`);
  url.searchParams.set('token', token);

  // Для сериалов открываем нужную серию сезона (sСЕЗОНvСЕРИЯ). Полная навигация
  // по сезонам/сериям при этом остаётся и внутри плеера.
  if (params.isSerial && params.episode && params.episode > 0) {
    const season = params.season && params.season > 0 ? params.season : 1;
    url.searchParams.set('video', `s${season}v${params.episode}`);
  }

  if (params.startFrom && params.startFrom > 0) {
    url.searchParams.set('start', String(Math.floor(params.startFrom)));
  }

  return url.toString();
}
