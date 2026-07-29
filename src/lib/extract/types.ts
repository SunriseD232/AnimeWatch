export type ExtractSource = 'alloha' | 'videoseed' | 'sibnet';

export interface ResolvedStream {
  /** Прямая ссылка на .mp4 или .m3u8, перехваченная у эмбед-плеера источника. */
  url: string;
  /** Заголовки, с которыми upstream отдаёт этот URL (обычно только Referer). */
  headers: Record<string, string>;
  isHls: boolean;
}

export interface ExtractParams {
  /** Для cinema — kinopoisk_id (как везде в проекте). */
  shikimoriId: number;
  season: number;
  episode: number;
  /** Конкретная озвучка (эмбед Alloha из списка переводов Yummy) — если не
   *  задано, VPS сам перебирает кандидатов и берёт первый рабочий. */
  embedUrl?: string;
}
