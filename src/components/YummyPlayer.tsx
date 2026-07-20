'use client';

import { useEffect, useState } from 'react';
import type { YummyTranslation } from '@/lib/video/yummy';

interface Props {
  shikimoriId: number;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  translations: YummyTranslation[];
}

/**
 * Резервный плеер Yummy (iframe на Kodik/Alloha/Sibnet — конкретный балансер
 * определяется выбранным вариантом озвучки). Протокол postMessage у чужого
 * плеера заранее неизвестен (зависит от того, кто именно отдал эту серию),
 * поэтому точного трекинга секунды здесь нет — только отметка «открыл эту
 * серию» (как для Videoseed в разделе кино), чтобы она попала в
 * «Продолжить просмотр». Список переводов и их embed-адреса уже готовы (со
 * стороны сервера), поэтому смена озвучки — мгновенная, без запроса.
 */
export default function YummyPlayer({
  shikimoriId,
  episode,
  animeTitle,
  posterUrl,
  isAuthed,
  translations,
}: Props) {
  const [translationId, setTranslationId] = useState<number | null>(
    translations[0]?.id ?? null,
  );
  const active =
    translations.find((t) => t.id === translationId) ?? translations[0] ?? null;

  // Смена серии — список переводов другой, сбрасываем на первый вариант.
  useEffect(() => {
    setTranslationId(translations[0]?.id ?? null);
  }, [translations]);

  // Отметка открытой серии — без точной позиции просмотра.
  useEffect(() => {
    if (!isAuthed) return;
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: 'anime',
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        season: 1,
        episode,
        mark: true,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [isAuthed, shikimoriId, episode, animeTitle, posterUrl]);

  if (!active) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        <iframe
          key={active.embedUrl}
          src={active.embedUrl}
          title={`${animeTitle} — серия ${episode}`}
          allowFullScreen
          allow="autoplay *; fullscreen *"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300">
          Источник: Yummy
        </span>
        {translations.length > 1 && (
          <>
            <span className="ml-1 text-gray-400">Озвучка:</span>
            <select
              value={translationId ?? ''}
              onChange={(e) => setTranslationId(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-bg-card px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Резервный источник: точная позиция просмотра не сохраняется.
      </p>
    </div>
  );
}
