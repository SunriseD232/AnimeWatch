'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import LoginBanner from '@/components/LoginBanner';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { fixPosterUrl, formatTime, watchPercent } from '@/lib/format';
import { ChevronRightIcon, XIcon } from '@/components/social/icons';
import type { ContinueEntry } from '@/components/ContinueCarousel';

const PAGE_SIZE = 3;

/**
 * Панель «Продолжить просмотр» новой главной — справа от hero на десктопе,
 * под ним на мобильном (см. план редизайна). В отличие от старой
 * ContinueCarousel (широкие карточки, горизонтальный скролл) — компактные
 * строки с пагинацией СТРАНИЦАМИ по PAGE_SIZE штук через стрелки в шапке:
 * тесная колонка не годится под горизонтальную карусель, а вертикальный
 * скролл внутри панели ломал бы её фиксированную высоту (= высоте hero).
 */
export default function ContinueWatchingPanel({
  entries,
  loggedIn,
}: {
  entries: ContinueEntry[];
  /** false — гость, вместо списка компактный LoginBanner (как и раньше). */
  loggedIn: boolean;
}) {
  const [list, setList] = useState(entries);
  const [page, setPage] = useState(0);
  const { toast } = useToast();

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => list.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [list, clampedPage],
  );

  async function remove(entry: ContinueEntry) {
    const supabase = createClient();
    const { error } = await supabase
      .from('watch_progress')
      .delete()
      .eq('content_type', entry.progress.content_type)
      .eq('shikimori_id', entry.progress.shikimori_id);
    if (error) {
      toast('Не удалось убрать из просмотра', 'error');
      return;
    }
    toast('Убрано из просмотра', 'success');
    setList((prev) => prev.filter((x) => x.progress.id !== entry.progress.id));
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-3xl bg-bg-card p-4 ring-1 ring-inset ring-white/5 lg:h-[440px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-100">Продолжить просмотр</h2>
        {loggedIn && list.length > PAGE_SIZE && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              aria-label="Предыдущие"
              className="press grid h-7 w-7 place-items-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRightIcon className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage >= pageCount - 1}
              aria-label="Следующие"
              className="press grid h-7 w-7 place-items-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {!loggedIn ? (
        <LoginBanner />
      ) : list.length === 0 ? (
        <div className="flex flex-1 items-center rounded-2xl bg-bg-soft p-4 text-sm text-gray-400">
          Здесь появятся тайтлы, которые вы смотрите. Начните с популярного ниже.
        </div>
      ) : (
        <div className="grid flex-1 grid-rows-3 gap-2">
          {visible.map((entry) => (
            <ContinueRow key={entry.progress.id} entry={entry} onRemove={() => void remove(entry)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContinueRow({ entry, onRemove }: { entry: ContinueEntry; onRemove: () => void }) {
  const { progress, localPoster, isMultiSeason } = entry;
  const percent = watchPercent(progress.position_seconds, progress.duration_seconds);
  const watchHref =
    progress.content_type === 'cinema'
      ? `/cinema/watch/${progress.shikimori_id}/${progress.season ?? 1}/${progress.episode}`
      : `/watch/${progress.shikimori_id}/${progress.episode}`;

  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-2xl bg-bg-soft pr-2 transition hover:bg-white/[0.06]">
      <Link href={watchHref} className="flex min-w-0 flex-1 items-center gap-3 py-1.5">
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-card">
          {progress.poster_url ? (
            <PosterImage
              sources={[localPoster, fixPosterUrl(progress.poster_url)]}
              alt={progress.anime_title}
              className="h-full w-full object-cover"
              placeholderClassName="grid h-full w-full place-items-center text-[10px] text-gray-500"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-[10px] text-gray-500">нет фото</div>
          )}
          {percent !== null && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-gray-100">{progress.anime_title}</p>
          <p className="truncate text-xs text-gray-400">
            {isMultiSeason ? `С${progress.season ?? 1} · Серия ${progress.episode}` : `Серия ${progress.episode}`}
            {' · '}
            {formatTime(progress.position_seconds)}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Убрать из просмотра"
        title="Убрать из просмотра"
        className="press hover-reveal grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-500 transition hover:bg-red-600 hover:text-white"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
