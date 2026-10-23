'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Ленивый маппинг источников из клиента.
 *
 * Server render не должен писать в БД (гонки + RLS), поэтому маппинг
 * строится здесь: один POST на /api/sources/resolve, затем refresh.
 * Повторно в рамках сессии не дёргаем — sessionStorage.
 *
 * Для манги `dir` — Remanga `dir`, для ранобэ — Renovels `dir`. Это seed:
 * точный маппинг каталога, чтобы не искать его заново по названию.
 */
export default function CanonicalBootstrap({
  contentType,
  titleKey,
  dir,
  title,
  altTitles,
  year,
  refresh = false,
}: {
  contentType: 'manga' | 'ranobe';
  titleKey: number;
  /** Точный слаг источника-каталога (Remanga/Renovels dir). */
  dir: string;
  title: string;
  altTitles: string[];
  year?: number;
  /** Пересобрать канонические главы (например, включили новый источник). */
  refresh?: boolean;
}) {
  const router = useRouter();
  const payloadRef = useRef({ dir, title, altTitles, year });
  const [status, setStatus] = useState<'checking' | 'done' | 'failed'>(
    'checking',
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // sessionStorage бросает исключение в приватном режиме части браузеров и
    // при запрещённых данных сайта. Без него просто теряем «не повторять в
    // этой сессии» — маппинг всё равно отработает.
    const storageKey = `aw_canonical_boot:${contentType}:${titleKey}`;
    const remember = () => {
      try {
        sessionStorage.setItem(storageKey, '1');
      } catch {
        /* см. выше */
      }
    };
    let alreadyDone = false;
    try {
      alreadyDone = sessionStorage.getItem(storageKey) != null;
    } catch {
      /* см. выше */
    }
    if (alreadyDone) {
      setStatus('done');
      return;
    }

    const controller = new AbortController();
    const payload = payloadRef.current;

    fetch('/api/sources/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        content_type: contentType,
        title_key: titleKey,
        external_id: payload.dir,
        title: payload.title,
        alt_titles: payload.altTitles,
        year: payload.year,
        refresh,
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { ok?: boolean } | null) => {
        if (controller.signal.aborted) return;
        if (data?.ok) {
          remember();
          setStatus('done');
          router.refresh();
        } else {
          setStatus('failed');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });

    return () => controller.abort();
  }, [contentType, refresh, router, titleKey]);

  if (status === 'checking') {
    return (
      <p className="text-xs text-gray-500">
        Проверяем дополнительные источники…
      </p>
    );
  }

  if (status === 'failed') {
    return (
      <p className="text-xs text-gray-500">
        Дополнительные источники сейчас недоступны.
      </p>
    );
  }

  return null;
}
