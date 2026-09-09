'use client';

import { useEffect, useRef, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import Link from 'next/link';
import { fixPosterUrl } from '@/lib/format';

/**
 * Строка каталога в списочном виде: постер слева, справа название, строка
 * характеристик и описание.
 *
 * Клиентский компонент из-за одной вещи — кнопки «ещё…». Влезло описание или
 * нет, известно только после верстки в браузере: зависит от ширины окна,
 * длины текста и высоты постера. Показывать кнопку всегда значило бы
 * предлагать «развернуть» там, где и так всё видно.
 */
export interface ListRowAnime {
  id: number;
  title: string;
  poster: string | null;
  kindLabel: string | null;
  statusLabel: string | null;
  year: number | null;
  episodesLabel: string | null;
  score: string | null;
  description: string | null;
}

export default function AnimeListRow({ anime }: { anime: ListRowAnime }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // Меряем после отрисовки и на каждом ресайзе: текст, влезавший в широком
  // окне, в узком перестаёт влезать, и кнопка должна появиться.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const measure = () => {
      if (expanded) return;
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, anime.description]);

  const meta = [anime.kindLabel, anime.statusLabel, anime.year ? String(anime.year) : null, anime.episodesLabel]
    .filter(Boolean)
    .join(' · ');

  const poster = fixPosterUrl(anime.poster);

  return (
    <div className="flex gap-4 rounded-2xl bg-bg-card p-3">
      {/* self-start обязателен: строка — это flex, а он по умолчанию тянет
          детей на всю высоту (align-items: stretch). Растянутая высота
          перебивала aspect-[3/4], и при раскрытии описания кнопкой «ещё…»
          постер вытягивался вертикально, а object-cover срезал его по бокам. */}
      <Link
        href={`/anime/${anime.id}`}
        className="press relative aspect-[3/4] w-24 shrink-0 self-start overflow-hidden rounded-xl bg-bg-soft sm:w-28"
      >
        {/* Тот же компонент с запасными ссылками, что и у карточек-плиток:
            битая картинка вместо постера выглядит хуже, чем подпись
            «нет постера». */}
        <PosterImage
          sources={[poster]}
          alt={anime.title}
          className="absolute inset-0 h-full w-full object-cover"
          placeholderClassName="grid h-full w-full place-items-center text-center text-xs text-gray-500"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/anime/${anime.id}`}
            className="line-clamp-2 font-semibold text-gray-100 transition hover:text-accent"
          >
            {anime.title}
          </Link>
          {anime.score && anime.score !== '0.0' && (
            <span className="shrink-0 rounded-md bg-bg-soft px-1.5 py-0.5 text-xs font-semibold text-yellow-400">
              ★ {anime.score}
            </span>
          )}
        </div>

        {/* Тот же набор и порядок, что на странице тайтла: тип, статус, год,
            число серий — чтобы список читался так же, как карточка. */}
        {meta && <p className="mt-1 text-xs text-gray-400">{meta}</p>}

        {anime.description && (
          <div className="mt-2 min-h-0">
            <p
              ref={textRef}
              className={`text-sm leading-snug text-gray-400 ${expanded ? '' : 'line-clamp-3'}`}
            >
              {anime.description}
            </p>
            {(clipped || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                // Акцентом — то есть цветом, который пользователь выбрал в
                // профиле (см. lib/theme.ts): кнопка обязана попадать в тему,
                // а не быть отдельным синим пятном.
                className="press mt-1 text-xs font-medium text-accent hover:text-accent-hover"
              >
                {expanded ? 'свернуть' : 'ещё…'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
