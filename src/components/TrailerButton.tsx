'use client';

import { useState } from 'react';

interface Props {
  /** Готовый embed-URL — для аниме он уже есть из Shikimori, без доп. запроса. */
  embedUrl?: string | null;
  /**
   * Ленивая подгрузка (кино/TMDB) — запрашивается только по клику, а не для
   * каждого сезона заранее. Должен вернуть { embedUrl: string | null }.
   */
  fetchUrl?: string;
  label?: string;
}

/**
 * Кнопка «Трейлер» + модалка с YouTube-embed. Два режима: готовый embedUrl
 * (аниме — уже есть в полной карточке Shikimori) или ленивая подгрузка через
 * fetchUrl (кино — трейлер только из TMDB, дорого тянуть на каждый сезон
 * заранее).
 */
export default function TrailerButton({ embedUrl, fetchUrl, label = 'Трейлер' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(embedUrl ?? null);
  const [notFound, setNotFound] = useState(false);

  async function handleClick() {
    if (resolvedUrl) {
      setOpen(true);
      return;
    }
    if (!fetchUrl) return;

    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(fetchUrl);
      const data = await res.json();
      if (data.embedUrl) {
        setResolvedUrl(data.embedUrl);
        setOpen(true);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="press flex items-center gap-2 rounded-full border border-white/10 bg-bg-card px-4 py-2.5 text-sm font-medium text-gray-100 hover:bg-bg-soft disabled:opacity-60"
      >
        <span>▶</span>
        <span>{loading ? 'Ищем…' : notFound ? 'Трейлер не найден' : label}</span>
      </button>

      {open && resolvedUrl && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="aspect-video w-full max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={`${resolvedUrl}?autoplay=1`}
              title={label}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </div>
      )}
    </>
  );
}
