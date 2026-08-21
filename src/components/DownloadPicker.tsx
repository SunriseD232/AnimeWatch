'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { OfflineDownload } from '@/native/offlineDownload';
import type { OwnPlayerTranslation } from '@/lib/extract/types';

interface SeasonInfo {
  season: number;
  episodes: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contentType: 'anime' | 'cinema';
  contentId: number;
  title: string;
  posterUrl: string | null;
  isSerial: boolean;
  /** Аниме: всего серий. Кино-фильм: 1. Кино-сериал: не используется — берём seasons. */
  totalEpisodes: number;
  /** Только кино-сериал — список сезонов с числом серий в каждом. */
  seasons: SeasonInfo[];
}

/** Скачиваемые источники — Aksor (DASH) не поддержан офлайн-загрузкой в v1
 *  (см. план офлайн-загрузок — только HLS с перечислимыми сегментами). */
function isDownloadable(t: OwnPlayerTranslation): boolean {
  return t.source != null && t.source !== 'aksor';
}

function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Модалка «Скачать» на карточке тайтла (см. anime/[shikimoriId]/page.tsx,
 * cinema/[id]/page.tsx) — точка входа в офлайн-загрузку. Кнопка «Скачать»
 * сознательно НЕ внутри плеера/настроек — иначе пришлось бы открывать
 * каждую серию отдельно, чтобы её скачать (см. план офлайн-загрузок).
 * Поток: 1) выбор озвучки, 2) чекбоксы серий (для сериала), 3) подтверждение
 * — дальше прогресс и сам плеер уже в нативной вкладке «Загрузки».
 */
export default function DownloadPicker({
  open,
  onClose,
  contentType,
  contentId,
  title,
  posterUrl,
  isSerial,
  totalEpisodes,
  seasons,
}: Props) {
  const { toast } = useToast();
  const [loadingTranslations, setLoadingTranslations] = useState(false);
  const [translations, setTranslations] = useState<OwnPlayerTranslation[]>([]);
  const [translationId, setTranslationId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isMovie = !isSerial;
  const chosenTranslation = translations.find((t) => t.id === translationId) ?? null;

  const allKeys = useMemo(() => {
    if (isMovie) return [] as string[];
    if (contentType === 'cinema') {
      return seasons.flatMap((s) =>
        Array.from({ length: s.episodes }, (_, i) => episodeKey(s.season, i + 1)),
      );
    }
    return Array.from({ length: totalEpisodes }, (_, i) => episodeKey(1, i + 1));
  }, [isMovie, contentType, seasons, totalEpisodes]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTranslationId(null);
    setTranslations([]);
    setLoadingTranslations(true);

    const fetchUrl =
      contentType === 'anime'
        ? `/api/watch/anime/${contentId}/1`
        : `/api/watch/cinema/${contentId}/1/1`;

    fetch(fetchUrl)
      .then((res) => res.json())
      .then((data) => {
        const list: OwnPlayerTranslation[] =
          contentType === 'anime'
            ? [...(data.yummyTranslations ?? []), ...(data.realdebridTranslations ?? [])]
            : (data.ownPlayerTranslations ?? []);
        const filtered = list.filter(isDownloadable);
        setTranslations(filtered);
        if (filtered.length > 0) setTranslationId(filtered[0].id);
      })
      .catch(() => setTranslations([]))
      .finally(() => setLoadingTranslations(false));
  }, [open, contentType, contentId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    panelRef.current?.focus();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === allKeys.length ? new Set() : new Set(allKeys)));
  }

  function toggleSeason(season: number, episodes: number) {
    const keys = Array.from({ length: episodes }, (_, i) => episodeKey(season, i + 1));
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  async function confirm() {
    if (!chosenTranslation) {
      toast('Выберите озвучку', 'info');
      return;
    }
    const pairs: { season: number; episode: number }[] = isMovie
      ? [{ season: 1, episode: 1 }]
      : Array.from(selected).map((k) => {
          const [s, e] = k.split(':').map(Number);
          return { season: s, episode: e };
        });
    if (pairs.length === 0) {
      toast('Выберите хотя бы одну серию', 'info');
      return;
    }

    setConfirming(true);
    const origin = window.location.origin;
    let queued = 0;
    let skipped = 0;

    try {
      if (contentType === 'cinema') {
        // Id озвучки стабилен между сериями/сезонами для кино (в отличие от
        // Yummy-аниме) — резолвить каждую серию отдельно не нужно, см.
        // комментарий про id/title-матчинг в WatchPlayer.tsx/Player.tsx.
        for (const { season, episode } of pairs) {
          const entryUrl = `${origin}/api/proxy/cinema/${contentId}/${season}/${episode}/${chosenTranslation.source}?t=${chosenTranslation.id}`;
          const id = `cinema:${contentId}:${season}:${episode}:${chosenTranslation.id}`;
          const episodeLabel = isMovie
            ? 'Фильм'
            : seasons.length > 1
              ? `Сезон ${season}, серия ${episode}`
              : `Серия ${episode}`;
          // eslint-disable-next-line no-await-in-loop
          await OfflineDownload.startDownload({
            id,
            entryUrl,
            contentType: 'cinema',
            contentId,
            season,
            episode,
            translationId: chosenTranslation.id,
            translationTitle: chosenTranslation.title,
            title,
            posterUrl,
            episodeLabel,
          });
          queued += 1;
        }
      } else {
        // Аниме: Yummy video_id (translationId) НЕ стабилен между сериями —
        // на каждую серию находим перевод с той же озвучкой заново по
        // названию (тот же приём, что прогрев следующей серии в
        // WatchPlayer.tsx), а не переиспользуем id с первой серии.
        const wantTitle = chosenTranslation.title;
        await mapWithConcurrency(pairs, 4, async ({ season, episode }) => {
          try {
            const res = await fetch(`/api/watch/anime/${contentId}/${episode}`);
            const data = await res.json();
            const list: OwnPlayerTranslation[] = [
              ...(data.yummyTranslations ?? []),
              ...(data.realdebridTranslations ?? []),
            ];
            const match = list.filter(isDownloadable).find((t) => t.title === wantTitle);
            if (!match) {
              skipped += 1;
              return;
            }
            const entryUrl = `${origin}/api/proxy/anime/${contentId}/1/${episode}/${match.source}?t=${match.id}`;
            const id = `anime:${contentId}:1:${episode}:${match.id}`;
            await OfflineDownload.startDownload({
              id,
              entryUrl,
              contentType: 'anime',
              contentId,
              season: 1,
              episode,
              translationId: match.id,
              translationTitle: match.title,
              title,
              posterUrl,
              episodeLabel: `Серия ${episode}`,
            });
            queued += 1;
          } catch {
            skipped += 1;
          }
        });
      }

      if (queued > 0) {
        toast(
          skipped > 0
            ? `Загрузка начата: ${queued} серий, пропущено ${skipped} (нет этой озвучки)`
            : isMovie
              ? 'Загрузка фильма начата — смотрите вкладку «Загрузки»'
              : `Загрузка начата: ${queued} серий — смотрите вкладку «Загрузки»`,
          'success',
        );
        onClose();
      } else {
        toast('Не удалось поставить в очередь — нет этой озвучки для выбранных серий', 'error');
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Скачать"
        tabIndex={-1}
        className="glass relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold">Скачать</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="press flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-1 text-sm font-medium text-gray-200">Озвучка</p>
          {loadingTranslations ? (
            <p className="text-sm text-gray-400">Загрузка…</p>
          ) : translations.length === 0 ? (
            <p className="text-sm text-gray-400">Нет доступных для скачивания озвучек</p>
          ) : (
            <div className="mb-4 flex flex-col gap-1.5">
              {translations.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"
                >
                  <input
                    type="radio"
                    name="translation"
                    checked={translationId === t.id}
                    onChange={() => setTranslationId(t.id)}
                    className="accent-accent"
                  />
                  <span className="text-gray-100">{t.title}</span>
                </label>
              ))}
            </div>
          )}

          {!isMovie && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-200">Серии</p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="press text-xs font-medium text-accent hover:text-accent-hover"
                >
                  {selected.size === allKeys.length ? 'Снять всё' : 'Выбрать всё'}
                </button>
              </div>

              {contentType === 'cinema' && seasons.length > 1 ? (
                <div className="flex flex-col gap-3">
                  {seasons.map((s) => (
                    <div key={s.season}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Сезон {s.season}</span>
                        <button
                          type="button"
                          onClick={() => toggleSeason(s.season, s.episodes)}
                          className="press text-xs text-accent hover:text-accent-hover"
                        >
                          Весь сезон
                        </button>
                      </div>
                      <div className="grid grid-cols-6 gap-1.5">
                        {Array.from({ length: s.episodes }, (_, i) => i + 1).map((ep) => (
                          <EpisodeCheckbox
                            key={ep}
                            checked={selected.has(episodeKey(s.season, ep))}
                            label={ep}
                            onToggle={() => toggle(episodeKey(s.season, ep))}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-1.5">
                  {allKeys.map((key) => {
                    const episode = Number(key.split(':')[1]);
                    return (
                      <EpisodeCheckbox
                        key={key}
                        checked={selected.has(key)}
                        label={episode}
                        onToggle={() => toggle(key)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={confirm}
            disabled={confirming || !chosenTranslation}
            className="press w-full rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {confirming ? 'Ставим в очередь…' : isMovie ? 'Скачать фильм' : `Скачать (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EpisodeCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'press rounded-md py-1.5 text-xs font-medium ring-1 transition',
        checked
          ? 'bg-accent text-white ring-accent'
          : 'bg-bg-card text-gray-300 ring-white/10 hover:ring-white/20',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
