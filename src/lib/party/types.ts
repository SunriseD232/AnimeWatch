import type { ContentType } from '@/lib/types';

/**
 * Совместный просмотр («Смотреть вместе») — общие типы для
 * WatchPartyProvider (синхронизация), OwnPlayer (управление видео) и страниц
 * просмотра (смена серии и озвучки).
 */

/** Что плеер знает о своём видео прямо сейчас. */
export interface PartyPlayerSnapshot {
  time: number;
  playing: boolean;
  rate: number;
  /** Длительность файла, если уже известна. */
  duration: number | null;
  /** Видео загружено и не перематывается — команды применять можно. */
  ready: boolean;
}

/**
 * Управление нашим плеером извне. Команды идут через внутренние флаги
 * OwnPlayer (пауза «от пользователя», беззвучный автозапуск), а не прямыми
 * video.play()/pause(): иначе его автозапуск тут же отменял бы чужую паузу,
 * а предохранитель от цикла пауз принимал бы команды комнаты за сбой.
 */
export interface PartyPlayerControl {
  snapshot(): PartyPlayerSnapshot | null;
  play(): void;
  pause(): void;
  seek(time: number): void;
  setRate(rate: number): void;
}

/** Действие, которое человек сделал в плеере сам (не пришло из комнаты). */
export type PartyUserAction = 'play' | 'pause' | 'seek' | 'rate';

/** Почему участник разослал состояние — для подписи «Аня: пауза». */
export type PartyStateKind = PartyUserAction | 'episode' | 'translation' | 'sync';

/**
 * Снимок хода просмотра. Позиция задаётся как «на момент at (часы сервера,
 * мс) было time секунд» — так опоздавший или переподключившийся сам
 * досчитывает, где все сейчас, и потерянное сообщение ничего не ломает.
 */
export interface PartyPlaybackState {
  season: number;
  episode: number;
  translationId: number | null;
  playing: boolean;
  time: number;
  rate: number;
  at: number;
  by: string;
  kind: PartyStateKind;
}

/** Что сейчас открыто у этого участника на странице просмотра. */
export interface PartyLocalContext {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  translationId: number | null;
}

export interface PartyInfo {
  id: string;
  contentType: ContentType;
  shikimoriId: number;
  title: string;
}

export interface PartyMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface PartyChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: number;
}

export const PARTY_MAX_MEMBERS = 5;
export const PARTY_CHAT_MAX_LENGTH = 500;
