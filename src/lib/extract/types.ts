export type ExtractSource = 'alloha' | 'videoseed' | 'sibnet' | 'kodik' | 'cvh';

export interface ResolvedStream {
  /** Прямая ссылка на .mp4 или .m3u8, перехваченная у эмбед-плеера источника. */
  url: string;
  /** Заголовки, с которыми upstream отдаёт этот URL (обычно только Referer). */
  headers: Record<string, string>;
  isHls: boolean;
  /** Kodik отдаёт отдельные m3u8 на каждое качество (не один master.m3u8 с
   *  вариантами) — если задано (>1 элемент), /api/proxy синтезирует master
   *  playlist из этих ссылок, чтобы hls.js/OwnPlayer видели обычный ABR-стрим
   *  с выбором качества. `url` при этом — просто лучшее качество, для
   *  совместимости с источниками без этого поля. */
  qualities?: { height: number; url: string }[];
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
