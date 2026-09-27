'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AnimeCredits } from '@/lib/shikimoriCredits';

// Тот же визуальный язык, что и у чипов жанров на странице тайтла (см.
// app/anime/[shikimoriId]/page.tsx) — имена людей и студий читаются как
// продолжение той же строки, а не отдельный чужеродный блок.
const CHIP_CLASS =
  'press rounded-md bg-bg-card px-2 py-1 text-gray-300 transition hover:bg-accent/15 hover:text-accent-text';

/**
 * Съёмочная группа и студия тайтла (см. ТЗ «связанные страницы персон и
 * студий»). credits.featured — курируемые роли (режиссёр, сценарист и
 * т.д., см. FEATURED_ROLES в lib/shikimoriCredits.ts), credits.allStaff —
 * полный список Shikimori (100+ строк у иных тайтлов) под разворотом:
 * показывать его сразу нечитаемо, а держать за отдельной страницей —
 * дороже, чем один клиентский toggle над уже загруженными данными.
 */
export default function TitleCredits({ credits }: { credits: AnimeCredits }) {
  const [expanded, setExpanded] = useState(false);

  if (credits.featured.length === 0 && credits.studios.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {credits.featured.map((group) => (
        <div key={group.role} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">{group.role}:</span>
          {group.people.map((p) => (
            <Link key={p.personId} href={`/person/shikimori/${p.personId}`} className={CHIP_CLASS}>
              {p.name}
            </Link>
          ))}
        </div>
      ))}

      {credits.studios.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">Студия:</span>
          {credits.studios.map((s) => (
            <Link key={s.studioId} href={`/company/shikimori/${s.studioId}`} className={CHIP_CLASS}>
              {s.name}
            </Link>
          ))}
        </div>
      )}

      {credits.allStaff.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="press text-xs text-gray-500 underline decoration-white/20 underline-offset-2 transition hover:text-accent-text hover:decoration-accent-text"
          >
            {expanded ? 'Свернуть' : 'Показать всю съёмочную группу'}
          </button>
          {expanded && (
            <div className="mt-2 flex flex-col gap-1 rounded-xl bg-bg-card p-3 text-xs ring-1 ring-inset ring-white/5">
              {credits.allStaff.map((s) => (
                <div
                  key={`${s.personId}-${s.rolesRu.join('|')}`}
                  className="flex flex-wrap items-baseline gap-1.5"
                >
                  <Link
                    href={`/person/shikimori/${s.personId}`}
                    className="text-gray-200 underline decoration-white/20 underline-offset-2 transition hover:text-accent-text hover:decoration-accent-text"
                  >
                    {s.name}
                  </Link>
                  <span className="text-gray-500">— {s.rolesRu.join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
