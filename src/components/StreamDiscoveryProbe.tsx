'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentType } from '@/lib/types';
import type { ExtractSource } from '@/lib/extract/types';

interface Props {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  source: ExtractSource;
  /** true — нашли и записали в кэш (можно ретраить /api/proxy), false — не вышло ни с одним кандидатом. */
  onDone: (found: boolean) => void;
}

const CANDIDATE_TIMEOUT_MS = 12_000;

interface ProbeMessage {
  __mediawatchProbe: true;
  type: 'stream-found';
  url: string;
}

function isProbeMessage(data: unknown): data is ProbeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).__mediawatchProbe === true &&
    (data as Record<string, unknown>).type === 'stream-found' &&
    typeof (data as Record<string, unknown>).url === 'string'
  );
}

/**
 * Скрытый iframe-зонд для клиентского перехвата (см. §12.6 ARCHITECTURE.md):
 * по очереди грузит кандидатов /api/proxy/mirror/... (эмбед источника,
 * зеркалированный нашим сервером), ждёт postMessage от инжектнутого туда
 * скрипта (buildInjectScript) с найденным .m3u8/.mp4, сообщает находку на
 * /api/extract/report и вызывает onDone(true). Если ни один кандидат не
 * ответил за отведённое время — onDone(false) (источник недоступен).
 *
 * Не display:none — некоторые антибот-эвристики трактуют нулевой размер
 * фрейма как признак бота; вместо этого уводим за пределы экрана, оставляя
 * реальный размер (как у обычного видимого плеера).
 */
export default function StreamDiscoveryProbe({
  contentType,
  shikimoriId,
  season,
  episode,
  source,
  onDone,
}: Props) {
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    doneRef.current = false;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({
        contentType,
        id: String(shikimoriId),
        season: String(season),
        episode: String(episode),
        source,
      });
      try {
        const res = await fetch(`/api/extract/embeds?${params}`);
        const data: { mirrorPaths?: string[] } = await res.json();
        if (cancelled) return;
        setCandidates(data.mirrorPaths ?? []);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, shikimoriId, season, episode, source]);

  useEffect(() => {
    if (candidates === null) return;
    if (attempt >= candidates.length) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDoneRef.current(false);
      }
      return;
    }

    let settled = false;
    const finish = async (url: string | null) => {
      if (settled) return;
      settled = true;
      if (!url) {
        setAttempt((a) => a + 1);
        return;
      }
      try {
        const res = await fetch('/api/extract/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType,
            id: shikimoriId,
            season,
            episode,
            source,
            url,
          }),
        });
        if (res.ok && !doneRef.current) {
          doneRef.current = true;
          onDoneRef.current(true);
          return;
        }
      } catch {
        /* падаем на следующего кандидата ниже */
      }
      setAttempt((a) => a + 1);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (isProbeMessage(event.data)) finish(event.data.url);
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(null), CANDIDATE_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [candidates, attempt, contentType, shikimoriId, season, episode, source]);

  const src = candidates && attempt < candidates.length ? candidates[attempt] : null;
  if (!src) return null;

  return (
    <iframe
      key={src}
      src={src}
      title="stream-probe"
      style={{ position: 'fixed', left: -9999, top: -9999, width: 1280, height: 720, border: 0 }}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
