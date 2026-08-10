import { registerPlugin } from '@capacitor/core';

/**
 * TS-обёртка нативного плагина ExternalDisplayPlugin (см.
 * ios/App/App/ExternalDisplayPlugin.swift) — рендер видео на внешний экран
 * (очки Xreal по USB-C DisplayPort) с продолжением воспроизведения при
 * заблокированном iPhone. На вебе (обычный браузер, без Capacitor) методы
 * этого плагина никогда не вызываются — см. проверку
 * Capacitor.isNativePlatform() в src/components/OwnPlayer.tsx — так что
 * само наличие импорта тут ничего не меняет для обычного сайта.
 */
export interface ExternalDisplayPlugin {
  /** Начать воспроизведение прямой ссылки на поток (та же, что уходит в
   *  hls.js на веб-стороне — /api/proxy/.../[source], см. OwnPlayer.tsx). */
  play(options: { url: string; startPositionSeconds: number }): Promise<void>;
  /** Остановить воспроизведение на внешнем экране. */
  stop(): Promise<void>;
  /** Подключён ли сейчас внешний экран (для начального состояния UI, до
   *  первого события externalScreenConnected/Disconnected). */
  isExternalScreenConnected(): Promise<{ connected: boolean }>;
  addListener(
    eventName: 'externalScreenConnected' | 'externalScreenDisconnected',
    listenerFunc: () => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: 'timeUpdate',
    listenerFunc: (data: { position: number }) => void,
  ): Promise<{ remove: () => void }>;
}

export const ExternalDisplay = registerPlugin<ExternalDisplayPlugin>('ExternalDisplay');
