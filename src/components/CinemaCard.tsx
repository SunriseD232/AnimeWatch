'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { CinemaShort } from '@/lib/videoseed-catalog';
import ExpandTitleButton from '@/components/ExpandTitleButton';

/**
 * Карточка фильма/сериала. Постеры приходят с хоста Videoseed
 * (api.videoseed.tv), поэтому используем обычный <img> без next/image —
 * так не нужен allowlist доменов и ничего не ломается на неизвестном хосте.
 */
export default function CinemaCard({
  item,
  /** Серия, на которой пользователь остановился (watch_progress) — null/не
   *  передан, если тайтл ещё не начат. */
  currentEpisode = null,
  /** Всего серий — CinemaShort (каталог) его не содержит, только
   *  CinemaFull (детальная карточка), поэтому это отдельный проп: страница
   *  каталога догружает его ТОЛЬКО для тайтлов с прогрессом (обычно
   *  единицы из 24), см. getCinemaEpisodesTotalMap. null — бейдж не рендерится
   *  (тайтл без прогресса, фильм, или подгрузка не удалась — fail-open). */
  episodesTotal = null,
}: {
  item: CinemaShort;
  currentEpisode?: number | null;
  episodesTotal?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // >1 — не показываем «1 из 1» у фильмов на одну серию.
  const showProgress = currentEpisode != null && episodesTotal != null && episodesTotal > 1;

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60">
      {/* prefetch={false}: /cinema/[id] — тяжёлая серверная страница (Videoseed +
          Supabase + похожее + проверка Vibix/Kodik), и при её медленном резолве
          автопрефетч Next.js иногда успевает выстрелить ВТОРЫМ, отдельным RSC-
          запросом почти одновременно с реальным переходом по клику — два
          параллельных потока на один и тот же маршрут ловят клиентский роутер
          в состояние гонки, и итоговое дерево коммитится ПУСТЫМ (без ошибки в
          консоли, без notFound/error.tsx — просто пустой <main>, лечится
          только полной перезагрузкой). Разница по времени видна ТОЛЬКО у
          /cinema/[id] (у /anime/[id] — быстрее, без Vibix/Kodik — не
          воспроизводится), так что отключаем префетч точечно тут.
          Обычный Link (не TransitionLink): переход должен показывать
          скелетон целевой страницы (см. loading.tsx), а не полноэкранный
          спиннер поверх старой — Next сам показывает loading.tsx сразу же
          при навигации, спиннер тут больше не нужен. */}
      <Link href={`/cinema/${item.id}`} prefetch={false} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {item.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.poster}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-400">
              нет постера
            </div>
          )}
          {item.rating !== null && (
            <span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-amber-300">
              ★ {item.rating.toFixed(1)}
            </span>
          )}
          {showProgress && (
            <>
              <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-gray-100">
                {currentEpisode}/{episodesTotal}
              </span>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: `${Math.min(100, ((currentEpisode as number) / (episodesTotal as number)) * 100)}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1 p-2.5">
          <h3
            ref={titleRef}
            className={[
              'text-sm font-medium leading-snug text-gray-100',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {item.title}
          </h3>
          <p className="text-xs text-gray-400">
            {[item.kind, item.year].filter(Boolean).join(' · ')}
          </p>
        </div>
      </Link>
      <ExpandTitleButton
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        titleRef={titleRef}
      />
    </div>
  );
}
