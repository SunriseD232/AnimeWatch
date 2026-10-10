'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTime } from '@/lib/format';
import { logEvent } from '@/lib/clientLog';
import { useToast } from '@/components/ToastProvider';
import type { ContentType } from '@/lib/types';
import type { PartyPlayerControl } from '@/lib/party/types';

/** Отлучка короче этого — не повод сверяться: на другом устройстве за такое
 *  время досмотреть ничего не успеть, а лишний запрос на каждое
 *  переключение вкладок ни к чему. */
const MIN_AWAY_MS = 30_000;
/** Своё же сохранение при уходе со вкладки приходит на сервер чуть позже
 *  момента ухода — запас, чтобы не принять его за чужое. */
const OWN_SAVE_SLACK_MS = 5_000;
/** Расхождение меньше этого — то же место, перематывать незачем. */
const MIN_POSITION_DIFF_S = 10;

interface Options {
  enabled: boolean;
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  controlRef: MutableRefObject<PartyPlayerControl | null>;
  /** На другом устройстве уже другая серия — переключиться на неё. */
  onOtherEpisode: (season: number, episode: number) => void;
}

/**
 * Продолжение с места, где досмотрели на ДРУГОМ устройстве.
 *
 * Позицию для «Нашего плеера» сервер подставляет при загрузке страницы — она
 * свежая. Но вкладка на компьютере часто вовсе не перезагружается: браузер
 * свернули, а не закрыли, вкладку усыпили или восстановили из памяти. Плеер
 * тогда стоит на старом месте, и play продолжал оттуда — да ещё и затирал
 * свежий прогресс с телефона старой позицией (жалоба 2026-10-10).
 *
 * Когда вкладка снова видна после отлучки (или страница вернулась из
 * bfcache), смотрим watch_progress: если его обновили уже ПОСЛЕ того, как мы
 * ушли, — это другое устройство. Та же серия — переходим на её позицию,
 * другая — переключаемся на серию. Только пока видео не играет: если человек
 * уже сам запустил просмотр здесь, его не дёргаем.
 */
export function useCrossDeviceResume({
  enabled,
  contentType,
  shikimoriId,
  season,
  episode,
  controlRef,
  onOtherEpisode,
}: Options) {
  const { toast } = useToast();
  const latest = useRef({ season, episode, onOtherEpisode });
  latest.current = { season, episode, onOtherEpisode };

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt = document.hidden ? Date.now() : 0;
    let cancelled = false;

    const check = async (awayFrom: number) => {
      if (!awayFrom || Date.now() - awayFrom < MIN_AWAY_MS) return;
      const { data: row } = await createClient()
        .from('watch_progress')
        .select('season, episode, position_seconds, duration_seconds, updated_at')
        .eq('content_type', contentType)
        .eq('shikimori_id', shikimoriId)
        .maybeSingle();
      if (cancelled || !row) return;
      if (new Date(row.updated_at).getTime() <= awayFrom + OWN_SAVE_SLACK_MS) return;

      const snap = controlRef.current?.snapshot() ?? null;
      if (snap?.playing) return;

      const { season: curSeason, episode: curEpisode, onOtherEpisode: goEpisode } = latest.current;
      const rowSeason = row.season ?? 1;
      if (rowSeason !== curSeason || row.episode !== curEpisode) {
        logEvent('player.cross_device_resume', { shikimoriId, kind: 'episode', season: rowSeason, episode: row.episode });
        toast(`Продолжаем с серии ${row.episode} — её смотрели на другом устройстве`);
        goEpisode(rowSeason, row.episode);
        return;
      }

      const pos = Number(row.position_seconds);
      const dur = row.duration_seconds != null ? Number(row.duration_seconds) : null;
      // Почти досмотренную серию сервер и при загрузке не продолжает (см.
      // nearEnd на страницах просмотра) — тут то же правило.
      if (!snap || !Number.isFinite(pos) || pos < 5 || (dur && pos / dur > 0.9)) return;
      if (Math.abs(pos - snap.time) < MIN_POSITION_DIFF_S) return;
      logEvent('player.cross_device_resume', { shikimoriId, kind: 'position', from: snap.time, to: pos });
      controlRef.current?.seek(pos);
      toast(`Продолжаем с ${formatTime(pos)} — с этого места смотрели на другом устройстве`);
    };

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const awayFrom = hiddenAt;
      hiddenAt = 0;
      void check(awayFrom);
    };
    let pagehideAt = 0;
    const onPageHide = () => {
      pagehideAt = Date.now();
    };
    // Возврат из bfcache — страница не перезагружалась, состояние старое.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check(pagehideAt);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [enabled, contentType, shikimoriId, controlRef, toast]);
}
