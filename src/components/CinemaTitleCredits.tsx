'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CinemaCredits } from '@/lib/tmdbCreditsShared';
import { CREW_JOB_LABELS_RU, FEATURED_CREW_JOBS, tmdbImageUrl } from '@/lib/tmdbCreditsShared';

const CHIP_CLASS =
  'press rounded-md bg-bg-card px-2 py-1 text-gray-300 transition hover:bg-accent/15 hover:text-accent-text';

const CAST_PREVIEW_COUNT = 9;
// У длинных сериалов (аниме тут ни при чём — только TMDB aggregate_credits)
// под одной должностью может набраться по эпизодному режиссёру за десяток
// сезонов — не единицы, а десятки имён. Схлопываем до 5 видимых элементов
// (4 человека + кнопка «ещё…» пятым), а не тащим полсотни чипов в шапку.
const FEATURED_PREVIEW_COUNT = 4;

/**
 * Съёмочная группа/каст фильма или сериала (см. ТЗ, фаза 2 — TMDB). Тот же
 * визуальный язык, что у TitleCredits.tsx (аниме/Shikimori): курируемые
 * роли — чипами, полный список крю — под разворотом. В отличие от аниме
 * здесь ЕСТЬ блок «В ролях» с фото и персонажем — у TMDB, в отличие от
 * Shikimori, актёр приходит одним запросом вместе с ролью, без пробелов в
 * данных, которые заставили пропустить этот блок для аниме (см.
 * lib/shikimoriCredits.ts).
 */
export default function CinemaTitleCredits({ credits }: { credits: CinemaCredits }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const toggleRole = (label: string) =>
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const featuredCrew = FEATURED_CREW_JOBS.map((job) => ({
    label: CREW_JOB_LABELS_RU[job] ?? job,
    people: credits.crew.filter((c) => c.job === job),
  })).filter((g) => g.people.length > 0);

  const restCrew = credits.crew.filter((c) => !FEATURED_CREW_JOBS.includes(c.job));
  const castPreview = credits.cast.slice(0, CAST_PREVIEW_COUNT);
  const castRest = credits.cast.slice(CAST_PREVIEW_COUNT);

  if (featuredCrew.length === 0 && credits.companies.length === 0 && credits.cast.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {featuredCrew.map((group) => {
          const isExpanded = expandedRoles.has(group.label);
          const showAll = isExpanded || group.people.length <= FEATURED_PREVIEW_COUNT + 1;
          const visible = showAll ? group.people : group.people.slice(0, FEATURED_PREVIEW_COUNT);
          return (
            <div key={group.label} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-500">{group.label}:</span>
              {visible.map((p) => (
                <Link key={p.id} href={`/person/tmdb/${p.id}`} className={CHIP_CLASS}>
                  {p.name}
                </Link>
              ))}
              {!showAll && (
                <button type="button" onClick={() => toggleRole(group.label)} className={CHIP_CLASS}>
                  ещё…
                </button>
              )}
              {isExpanded && group.people.length > FEATURED_PREVIEW_COUNT + 1 && (
                <button type="button" onClick={() => toggleRole(group.label)} className={CHIP_CLASS}>
                  Свернуть
                </button>
              )}
            </div>
          );
        })}
        {credits.companies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-500">Студия:</span>
            {credits.companies.map((c) => (
              <Link key={c.id} href={`/company/tmdb/${c.id}`} className={CHIP_CLASS}>
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {credits.cast.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-500">В ролях</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
            {(expanded ? credits.cast : castPreview).map((c) => (
              <Link
                key={c.id}
                href={`/person/tmdb/${c.id}`}
                className="press flex flex-col items-center gap-1 text-center"
              >
                <div className="h-14 w-14 overflow-hidden rounded-full bg-bg-card ring-1 ring-white/5">
                  {tmdbImageUrl(c.profilePath) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tmdbImageUrl(c.profilePath) as string}
                      alt={c.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] text-gray-500">Нет фото</div>
                  )}
                </div>
                <span className="line-clamp-1 text-xs text-gray-200">{c.name}</span>
                {c.character && <span className="line-clamp-1 text-[11px] text-gray-500">{c.character}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {(castRest.length > 0 || restCrew.length > 0) && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="press text-xs text-gray-500 underline decoration-white/20 underline-offset-2 transition hover:text-accent-text hover:decoration-accent-text"
          >
            {expanded ? 'Свернуть' : 'Все актёры и создатели'}
          </button>
          {expanded && restCrew.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 rounded-xl bg-bg-card p-3 text-xs ring-1 ring-inset ring-white/5">
              {restCrew.map((c) => (
                <div key={`${c.id}-${c.job}`} className="flex flex-wrap items-baseline gap-1.5">
                  <Link
                    href={`/person/tmdb/${c.id}`}
                    className="text-gray-200 underline decoration-white/20 underline-offset-2 transition hover:text-accent-text hover:decoration-accent-text"
                  >
                    {c.name}
                  </Link>
                  <span className="text-gray-500">— {CREW_JOB_LABELS_RU[c.job] ?? c.job}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
