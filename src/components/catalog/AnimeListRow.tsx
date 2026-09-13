'use client';

import { useEffect, useRef, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import Link from 'next/link';
import { fixPosterUrl } from '@/lib/format';
import { useQuickListStatus } from '@/components/useQuickListStatus';
import { LIST_STATUS_OPTIONS } from '@/lib/listStatus';
import type { ContentType } from '@/lib/types';
import { CheckIcon, PlusIcon, StarIcon, UsersIcon } from '@/components/social/icons';

/**
 * Строка каталога в списочном виде: постер слева, справа название, строка
 * характеристик и описание. Одна и та же для аниме и для кино — отличаются
 * только подписи в строке характеристик и куда ведёт ссылка (`href`).
 *
 * Клиентский компонент из-за одной вещи — кнопки «ещё…». Влезло описание или
 * нет, известно только после верстки в браузере: зависит от ширины окна,
 * длины текста и высоты постера. Показывать кнопку всегда значило бы
 * предлагать «развернуть» там, где и так всё видно.
 */
export interface ListRowAnime {
  id: number;
  /** Для быстрого добавления в список прямо со строки (см. ListRowQuickAdd
   *  ниже) — сам upsert различает аниме/кино по этому полю. */
  contentType: ContentType;
  /** Куда ведёт карточка: /anime/<id> или /cinema/<id>. */
  href: string;
  title: string;
  /** Запасная ссылка на постер, если основная не открылась. */
  posterFallback?: string | null;
  poster: string | null;
  kindLabel: string | null;
  statusLabel: string | null;
  year: number | null;
  episodesLabel: string | null;
  score: string | null;
  /** Средняя оценка зрителей сайта — пока только у кино (см. CinemaCard). */
  siteScore?: { average: number; votes: number } | null;
  description: string | null;
}

export default function AnimeListRow({ anime }: { anime: ListRowAnime }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const { status, saving, choose } = useQuickListStatus({
    shikimoriId: anime.id,
    contentType: anime.contentType,
    title: anime.title,
    posterUrl: anime.poster,
    source: 'list-row',
  });

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

  // Радиусы концентричны: внешний = внутренний + отступ. Постер скруглён на
  // 12px при p-3 (тоже 12), значит у карточки 24px, а не 16 — при 16 внешний
  // угол «врезался» в угол постера, и строка выглядела слегка кривой, хотя
  // ничего не съехало.
  return (
    <div className="flex gap-4 rounded-3xl bg-bg-card p-3">
      {/* self-start обязателен: строка — это flex, а он по умолчанию тянет
          детей на всю высоту (align-items: stretch). Растянутая высота
          перебивала aspect-[3/4], и при раскрытии описания кнопкой «ещё…»
          постер вытягивался вертикально, а object-cover срезал его по бокам. */}
      <Link
        href={anime.href}
        className="press relative aspect-[3/4] w-24 shrink-0 self-start overflow-hidden rounded-xl bg-bg-soft sm:w-28"
      >
        {/* Тот же компонент с запасными ссылками, что и у карточек-плиток:
            битая картинка вместо постера выглядит хуже, чем подпись
            «нет постера». */}
        <PosterImage
          sources={[poster, fixPosterUrl(anime.posterFallback ?? null)]}
          alt={anime.title}
          className="absolute inset-0 h-full w-full object-cover"
          placeholderClassName="grid h-full w-full place-items-center text-center text-xs text-gray-400"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={anime.href}
            className="line-clamp-2 font-semibold text-gray-100 transition hover:text-accent-text"
          >
            {anime.title}
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            {anime.siteScore && anime.siteScore.votes > 0 && (
              <span
                className="relative inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-fg"
                title={`Оценка зрителей MediaWatch, голосов: ${anime.siteScore.votes}`}
              >
                <UsersIcon className="h-3 w-3" />
                {anime.siteScore.average.toFixed(1)}
                <span className="sr-only"> — оценка зрителей MediaWatch</span>
              </span>
            )}
            {anime.score && anime.score !== '0.0' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-1.5 py-0.5 text-xs font-semibold text-yellow-400">
                <StarIcon className="h-3 w-3" filled />
                {anime.score}
              </span>
            )}
            {/* Быстрое добавление в список — тот же кружок, что «+»/«i» на
                карточке-плитке, только раскрывает не всплывающее меню, а
                свою полосу статусов под строкой (см. панель ниже): в
                списочном виде под рукой уже страница тайтла по клику на
                название, отдельный портал был бы лишним слоем. */}
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={listOpen}
              aria-busy={saving}
              aria-label={status ? 'Изменить статус в списке' : 'Добавить в список'}
              title={status ? 'В списке' : 'Добавить в список'}
              // Видимый значок — 24px (WCAG-минимум впритык), область
              // нажатия расширена псевдоэлементом до ~36px — тот же приём,
              // что у «i»/«+» на карточке-плитке (ExpandTitleButton).
              className={[
                'press relative grid h-6 w-6 shrink-0 place-items-center rounded-full transition',
                "before:absolute before:inset-[-6px] before:content-['']",
                status
                  ? 'bg-accent/90 text-accent-fg hover:bg-accent'
                  : 'bg-bg-soft text-gray-400 hover:bg-white/10 hover:text-white',
              ].join(' ')}
            >
              {status ? <CheckIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Тот же набор и порядок, что на странице тайтла: тип, статус, год,
            число серий — чтобы список читался так же, как карточка. */}
        {meta && <p className="mt-1 text-xs text-gray-400">{meta}</p>}

        {/* Полоса статусов «выезжает» из-под строки — grid-template-rows
            0fr→1fr, чистый CSS без измерения высоты в JS. Раскрывается
            под самим тайтлом, а не всплывающим меню поверх контента: в
            списочном виде рядом со строкой обычно следующая строка того же
            списка, и плавающая панель либо перекрыла бы её, либо не
            влезла бы вбок на телефоне. */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            listOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div
              role="radiogroup"
              aria-label="Статус в списке"
              className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2"
            >
              {LIST_STATUS_OPTIONS.map((o) => {
                const selected = status === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      void choose(o.value);
                      setListOpen(false);
                    }}
                    className={[
                      'press rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition',
                      selected
                        ? 'bg-accent/10 text-accent-text ring-accent/60'
                        : 'bg-bg-soft text-gray-300 ring-white/5 hover:ring-white/20',
                    ].join(' ')}
                  >
                    {o.label}
                  </button>
                );
              })}
              {status && (
                <button
                  type="button"
                  onClick={() => {
                    void choose(null);
                    setListOpen(false);
                  }}
                  className="press rounded-lg px-2.5 py-1 text-xs font-medium text-red-300 ring-1 ring-white/5 transition hover:bg-red-500/10 hover:ring-red-500/30"
                >
                  Убрать из списка
                </button>
              )}
            </div>
          </div>
        </div>

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
                className="press mt-1 text-xs font-medium text-accent-text hover:text-accent-hover"
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
