import type { ExtractSource } from '@/lib/extract/types';

export interface MirrorSourceConfig {
  /** Домен эмбед-плеера, который зеркалируем (см. §12.6 ARCHITECTURE.md). */
  host: string;
  /** Referer, которого ждёт антихотлинк источника на top-level запросе. */
  referer: string;
  /** Нужен ли RU-прокси для запросов к этому источнику (см. ALLOHA_PROXY_*). */
  useProxy: boolean;
}

function videoseedHost(): string {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

/** Конфиг зеркала на источник — читается лениво (VIDEOSEED_HOST из окружения). */
export function getMirrorSourceConfig(source: string): MirrorSourceConfig | null {
  switch (source as ExtractSource) {
    case 'alloha':
      return { host: 'alloha.yani.tv', referer: 'https://yani.tv/', useProxy: true };
    case 'videoseed':
      // ВРЕМЕННО true: диагностика "TypeError: fetch failed" к tv-1-kinoserial.net.
      return { host: videoseedHost(), referer: `https://${videoseedHost()}/`, useProxy: true };
    default:
      return null;
  }
}
