import { registerPlugin } from '@capacitor/core';

/**
 * TS-обёртка нативного плагина OfflineDownloadPlugin (см.
 * ios/App/App/OfflineDownloadPlugin.swift) — офлайн-загрузка серий/фильмов
 * для просмотра без сети. Сам процесс скачивания и офлайн-плеер живут в
 * нативной вкладке «Загрузки» (таб-бар, SceneDelegate.swift) — со стороны
 * сайта этот плагин нужен только чтобы сообщить состояние авторизации и
 * поставить серию/фильм в очередь на скачивание (см. DownloadPicker.tsx).
 * На вебе (обычный браузер, без Capacitor) методы этого плагина никогда не
 * вызываются — см. Capacitor.isNativePlatform() в местах использования.
 */

export type OfflineDownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'paused';

export interface OfflineDownloadItem {
  id: string;
  contentType: 'anime' | 'cinema';
  contentId: number;
  season: number;
  episode: number;
  translationId: number;
  translationTitle: string;
  title: string;
  posterUrl: string | null;
  episodeLabel: string;
  status: OfflineDownloadStatus;
  totalSegments: number;
  completedSegments: number;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  lastPositionSeconds: number;
  durationSeconds: number | null;
}

export interface PendingProgressEntry {
  /** "contentType:contentId" — тот же ключ передаётся обратно в
   *  clearSyncedProgress после синхронизации. */
  key: string;
  contentType: 'anime' | 'cinema';
  contentId: number;
  season: number;
  episode: number;
  positionSeconds: number;
  durationSeconds: number | null;
  title: string;
  posterUrl: string | null;
  translationId: number | null;
  translationTitle: string | null;
  updatedAt: string;
}

export interface StartDownloadOptions {
  id: string;
  entryUrl: string;
  contentType: 'anime' | 'cinema';
  contentId: number;
  season: number;
  episode: number;
  translationId: number;
  translationTitle: string;
  title: string;
  posterUrl: string | null;
  episodeLabel: string;
}

export interface OfflineDownloadPlugin {
  setAuthState(options: { isAuthed: boolean; userId: string | null }): Promise<void>;
  getAuthState(): Promise<{ isAuthed: boolean; userId: string | null }>;
  getStorageInfo(): Promise<{ usedBytes: number; freeBytes: number }>;

  /** Ставит серию/фильм в очередь на скачивание — дальнейший прогресс и
   *  управление (пауза/отмена/удаление) — уже в нативной вкладке «Загрузки». */
  startDownload(options: StartDownloadOptions): Promise<void>;
  pauseDownload(options: { id: string }): Promise<void>;
  resumeDownload(options: { id: string }): Promise<void>;
  cancelDownload(options: { id: string }): Promise<void>;
  deleteDownload(options: { id: string }): Promise<void>;
  listDownloads(): Promise<{ items: OfflineDownloadItem[] }>;
  getDownloadStatus(options: { id: string }): Promise<{ item: OfflineDownloadItem | null }>;
  setAllowCellular(options: { allow: boolean }): Promise<void>;

  /** Очередь офлайн-прогресса, накопленную time observer'ом офлайн-плеера
   *  (см. DownloadPlayerView.swift) — синхронизируется на /api/progress/sync
   *  при восстановлении сети (см. OfflineSyncTrigger.tsx). */
  getPendingProgress(): Promise<{ items: PendingProgressEntry[] }>;
  /** Убрать записи из очереди после успешного раунда синхронизации —
   *  ключи те же, что в PendingProgressEntry.key. */
  clearSyncedProgress(options: { keys: string[] }): Promise<void>;

  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: { id: string; completed: number; total: number }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: 'downloadComplete',
    listenerFunc: (data: { id: string }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: 'downloadFailed',
    listenerFunc: (data: { id: string; error: string }) => void,
  ): Promise<{ remove: () => void }>;
}

export const OfflineDownload = registerPlugin<OfflineDownloadPlugin>('OfflineDownload');
