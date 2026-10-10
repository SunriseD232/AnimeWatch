'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { logEvent } from '@/lib/clientLog';

/**
 * Трансляция на телевизор из «Нашего плеера».
 *
 * Два разных механизма, потому что у браузеров они разные:
 *
 * - Chromecast (Chrome и Edge на компьютере и Android; телевизоры с Google TV
 *   / Android TV и приставки Chromecast). Через Google Cast SDK: телевизор
 *   сам открывает «стандартный ресивер» Google и играет поток по нашей
 *   ссылке /api/proxy/... — ссылки CDN привязаны к IP сервера, поэтому всё
 *   идёт через наш прокси, а ему для ресивера нужен CORS (см. middleware.ts).
 *
 * - AirPlay (Safari на iPhone, iPad и Mac). Системный выбор устройства;
 *   работает, только когда видео играет сам Safari, а не hls.js через MSE:
 *   поток из MSE на Apple TV не передаётся. Поэтому кнопку показываем лишь
 *   при «обычном» src (нативный HLS, mp4).
 *
 * Обычные «умные» телевизоры без Chromecast и AirPlay (DLNA) из браузера
 * недоступны вовсе — у веба нет к ним доступа.
 */

const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

// Минимальные типы Cast SDK — пакета @types для него в проекте нет, а
// тянуть зависимость ради пяти вызовов незачем.
interface CastSessionLike {
  loadMedia(request: unknown): Promise<unknown>;
  getCastDevice(): { friendlyName: string };
  endSession(stopCasting: boolean): void;
}
interface CastContextLike {
  setOptions(opts: Record<string, unknown>): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSessionLike | null;
  getCastState(): string;
  addEventListener(type: string, cb: (e: { castState?: string; sessionState?: string }) => void): void;
  removeEventListener(type: string, cb: (e: { castState?: string; sessionState?: string }) => void): void;
}
interface RemotePlayerLike {
  isConnected: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
}
interface RemotePlayerControllerLike {
  playOrPause(): void;
  seek(): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}
interface CastGlobals {
  cast?: {
    framework: {
      CastContext: { getInstance(): CastContextLike };
      CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
      CastState: { NO_DEVICES_AVAILABLE: string };
      SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string };
      RemotePlayer: new () => RemotePlayerLike;
      RemotePlayerController: new (player: RemotePlayerLike) => RemotePlayerControllerLike;
      RemotePlayerEventType: { ANY_CHANGE: string };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (url: string, contentType: string) => Record<string, unknown>;
        GenericMediaMetadata: new () => Record<string, unknown>;
        LoadRequest: new (info: unknown) => Record<string, unknown>;
        HlsSegmentFormat?: { TS: string };
        HlsVideoSegmentFormat?: { MPEG2_TS: string };
      };
    };
  };
  __onGCastApiAvailable?: (available: boolean) => void;
}

type WebkitVideo = HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void };

let sdkPromise: Promise<boolean> | null = null;
/** Cast SDK — один раз на страницу и только в Chromium: в Safari и Firefox
 *  он не работает, и грузить его там незачем. */
function loadCastSdk(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;
  const w = window as unknown as CastGlobals & { chrome?: unknown };
  const isChromium = typeof w.chrome === 'object' && /Chrome|CriOS|Edg/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  if (!isChromium) {
    sdkPromise = Promise.resolve(false);
    return sdkPromise;
  }
  sdkPromise = new Promise<boolean>((resolve) => {
    w.__onGCastApiAvailable = (available) => resolve(available);
    const script = document.createElement('script');
    script.src = CAST_SDK_URL;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export interface CastMedia {
  /** Абсолютная ссылка на поток (наш прокси). */
  url: string;
  contentType: string;
  title: string;
  subtitle?: string;
  posterUrl?: string | null;
}

export interface CastState {
  /** Есть Chromecast в сети — показывать кнопку. */
  chromecastAvailable: boolean;
  /** В сети есть устройства AirPlay (передать можно только не-MSE поток). */
  airplayAvailable: boolean;
  /** Идёт трансляция Chromecast. */
  casting: boolean;
  deviceName: string | null;
  remotePaused: boolean;
  remoteTime: number;
  startChromecast: () => Promise<void>;
  stopChromecast: () => void;
  toggleRemotePause: () => void;
  showAirplayPicker: () => void;
}

export function useCast(
  videoRef: RefObject<HTMLVideoElement | null>,
  /** Что транслировать прямо сейчас и с какой секунды. */
  getMedia: () => CastMedia | null,
  /** Трансляция закончилась — продолжить у себя с этой секунды. */
  onCastEnded: (time: number) => void,
  /** Меняется при пересоздании <video> (смена серии/источника). */
  videoKey: unknown,
): CastState {
  const [chromecastAvailable, setChromecastAvailable] = useState(false);
  const [airplayAvailable, setAirplayAvailable] = useState(false);
  const [casting, setCasting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [remotePaused, setRemotePaused] = useState(false);
  const [remoteTime, setRemoteTime] = useState(0);
  const contextRef = useRef<CastContextLike | null>(null);
  const controllerRef = useRef<RemotePlayerControllerLike | null>(null);
  const playerRef = useRef<RemotePlayerLike | null>(null);
  const onEndedRef = useRef(onCastEnded);
  onEndedRef.current = onCastEnded;

  // --- Chromecast: SDK и состояние устройств ---------------------------------
  useEffect(() => {
    let cancelled = false;
    let ctx: CastContextLike | null = null;
    const onCastState = (e: { castState?: string }) => {
      const w = window as unknown as CastGlobals;
      setChromecastAvailable(e.castState !== w.cast?.framework.CastState.NO_DEVICES_AVAILABLE);
    };
    void loadCastSdk().then((ok) => {
      const w = window as unknown as CastGlobals;
      if (cancelled || !ok || !w.cast || !w.chrome?.cast) return;
      const fw = w.cast.framework;
      ctx = fw.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      contextRef.current = ctx;
      onCastState({ castState: ctx.getCastState() });
      ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, onCastState);

      const player = new fw.RemotePlayer();
      const controller = new fw.RemotePlayerController(player);
      playerRef.current = player;
      controllerRef.current = controller;
      let wasConnected = false;
      controller.addEventListener(fw.RemotePlayerEventType.ANY_CHANGE, () => {
        setCasting(player.isConnected);
        setRemotePaused(player.isPaused);
        setRemoteTime(player.currentTime);
        if (wasConnected && !player.isConnected) {
          // Трансляцию закрыли (с телевизора, из меню Chrome или кнопкой) —
          // продолжаем у себя с того места, где остановился телевизор.
          onEndedRef.current(player.currentTime);
          setDeviceName(null);
        }
        wasConnected = player.isConnected;
      });
    });
    return () => {
      cancelled = true;
      const w = window as unknown as CastGlobals;
      if (ctx && w.cast) ctx.removeEventListener(w.cast.framework.CastContextEventType.CAST_STATE_CHANGED, onCastState);
    };
  }, []);

  const startChromecast = useCallback(async () => {
    const ctx = contextRef.current;
    const w = window as unknown as CastGlobals;
    const media = getMedia();
    if (!ctx || !w.chrome?.cast || !media) return;
    try {
      await ctx.requestSession();
    } catch {
      return; // человек закрыл выбор устройства
    }
    const session = ctx.getCurrentSession();
    if (!session) return;
    const m = w.chrome.cast.media;
    const info = new m.MediaInfo(media.url, media.contentType);
    // Сегменты у наших HLS-источников — MPEG-TS; новые ресиверы без явного
    // указания ждут fMP4 и молча не играют.
    if (media.contentType.includes('mpegurl')) {
      if (m.HlsSegmentFormat) info.hlsSegmentFormat = m.HlsSegmentFormat.TS;
      if (m.HlsVideoSegmentFormat) info.hlsVideoSegmentFormat = m.HlsVideoSegmentFormat.MPEG2_TS;
    }
    const meta = new m.GenericMediaMetadata();
    meta.title = media.title;
    if (media.subtitle) meta.subtitle = media.subtitle;
    if (media.posterUrl) meta.images = [{ url: media.posterUrl }];
    info.metadata = meta;
    const request = new m.LoadRequest(info);
    request.currentTime = videoRef.current?.currentTime ?? 0;
    request.autoplay = true;
    try {
      await session.loadMedia(request);
      videoRef.current?.pause();
      setDeviceName(session.getCastDevice().friendlyName);
      logEvent('player.cast_start', { kind: 'chromecast' });
    } catch (err) {
      logEvent('player.cast_failed', { kind: 'chromecast', error: String(err) });
      session.endSession(true);
    }
  }, [getMedia, videoRef]);

  const stopChromecast = useCallback(() => {
    contextRef.current?.getCurrentSession()?.endSession(true);
  }, []);

  const toggleRemotePause = useCallback(() => {
    controllerRef.current?.playOrPause();
  }, []);

  // --- AirPlay ---------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current as WebkitVideo | null;
    if (!video || typeof window === 'undefined' || !('WebKitPlaybackTargetAvailabilityEvent' in window)) {
      setAirplayAvailable(false);
      return;
    }
    const onAvailability = (e: Event) => {
      // Есть ли устройства — и только. Можно ли передать именно этот поток
      // (не MSE), решает плеер при отрисовке: на момент события src может
      // быть ещё не задан.
      setAirplayAvailable((e as Event & { availability?: string }).availability === 'available');
    };
    video.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
    return () => video.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
  }, [videoRef, videoKey]);

  const showAirplayPicker = useCallback(() => {
    const video = videoRef.current as WebkitVideo | null;
    video?.webkitShowPlaybackTargetPicker?.();
    logEvent('player.cast_start', { kind: 'airplay' });
  }, [videoRef]);

  return {
    chromecastAvailable,
    airplayAvailable,
    casting,
    deviceName,
    remotePaused,
    remoteTime,
    startChromecast,
    stopChromecast,
    toggleRemotePause,
    showAirplayPicker,
  };
}
