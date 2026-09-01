export type ExtractSource = 'alloha' | 'videoseed' | 'sibnet' | 'kodik' | 'cvh' | 'aksor' | 'realdebrid';

export interface ResolvedStream {
  /** Прямая ссылка на .mp4/.m3u8/.mpd, перехваченная у эмбед-плеера источника. */
  url: string;
  /** Заголовки, с которыми upstream отдаёт этот URL (обычно только Referer). */
  headers: Record<string, string>;
  isHls: boolean;
  /** Aksor отдаёт DASH (.mpd), а не HLS — /api/proxy проксирует манифест
   *  иначе (rewriteDashManifest, не rewriteM3U8), и OwnPlayer подключает
   *  dash.js вместо hls.js. Взаимоисключающе с isHls (оба false — plain mp4). */
  isDash?: boolean;
  /** Kodik/Aksor отдают отдельный манифест на каждое качество (не один
   *  master с ABR-вариантами) — если задано (>1 элемент), /api/proxy либо
   *  синтезирует HLS master (Kodik/Videoseed), либо позволяет запросить
   *  конкретное качество через ?q=<height> (Aksor, см. rewriteDashManifest —
   *  DASH-манифесты по разным качествам живут в РАЗНЫХ директориях, слить в
   *  один ABR-манифест сложнее и рискованнее, чем просто перезапросить). `url`
   *  при этом — лучшее качество по умолчанию, для источников без этого поля. */
  qualities?: { height: number; url: string }[];
  /** Внешние субтитры (сейчас только Videoseed отдаёт реальные .vtt — Alloha/
   *  Sibnet/Kodik/CVH ничего подобного не предоставляют, см. коммит). */
  subtitles?: Subtitle[];
}

/** Одна дорожка субтитров — lang используется и для матчинга/индекса, и как
 *  <track srclang>, label — то, что видит пользователь в селекторе. */
export interface Subtitle {
  lang: string;
  label: string;
  url: string;
}

export interface ExtractParams {
  /** Для cinema — kinopoisk_id (как везде в проекте). */
  shikimoriId: number;
  season: number;
  episode: number;
  /** Конкретная озвучка (эмбед Alloha из списка переводов Yummy) — если не
   *  задано, VPS сам перебирает кандидатов и берёт первый рабочий. */
  embedUrl?: string;
  /** Человекочитаемое имя озвучки (short_name/name из каталога Videoseed,
   *  без суффикса " · Videoseed" из title, см. resolve.ts) — только для
   *  source='videoseed' с выбранной озвучкой. HTTP-путь извлечения
   *  (vps-extractor/src/videoseed-http.js) сам не знает человекочитаемых
   *  имён озвучек (их нет в embed-конфиге ни в каком другом виде, кроме
   *  как в виде "{Label}" перед каждой ссылкой), поэтому единственный
   *  способ выбрать нужную — сопоставить по этой строке. */
  translationLabel?: string;
}

/**
 * Одна озвучка в селекторе OwnPlayer — источник переводов разный для аниме
 * (Yummy, см. lib/video/yummy.ts) и кино (Kodik по kinopoisk_id, см.
 * lib/video/kodik.ts getKodikOwnPlayerTranslations), но форма общая.
 */
export interface OwnPlayerTranslation {
  id: number;
  title: string;
  embedUrl: string;
  /** Источник, через который /api/proxy умеет извлечь и проксировать этот
   *  перевод. null — только сторонний iframe-плеер, извлечения ещё нет. */
  source: ExtractSource | null;
}
