/**
 * Абстракция источника видео. Позволяет заменить провайдера (Kodik → другой),
 * не трогая остальное приложение.
 */

export interface Translation {
  id: number;
  title: string;
  type: string; // 'voice' | 'subtitles' | ...
}

export interface EmbedResult {
  /** Готовый URL для iframe (может быть протокол-относительным //...). */
  embedUrl: string;
  /** Доступные озвучки/переводы (может быть пусто в fallback-режиме). */
  translations: Translation[];
  /** Всего серий по данным провайдера, если известно. */
  episodesTotal: number | null;
  /** Использован fallback без реального API-поиска. */
  fallback: boolean;
}

export interface GetEmbedParams {
  /** Внешний id для поиска в Kodik. Для аниме — shikimori_id. */
  shikimoriId?: number;
  /** Для фильмов/сериалов — kinopoisk_id (взаимоисключимо с shikimoriId). */
  kinopoiskId?: number;
  episode: number;
  translationId?: number;
  /** Стартовая позиция в секундах для восстановления просмотра. */
  startFrom?: number;
}

export interface VideoSource {
  getEmbedUrl(params: GetEmbedParams): Promise<EmbedResult>;
}
