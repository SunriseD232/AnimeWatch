'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import type { SiteRating } from '@/lib/social/types';
import type { ContentType } from '@/lib/types';
import { ChevronDownIcon, StarIcon, UsersIcon } from './icons';

/**
 * Оценка тайтла на его странице: своя оценка и средняя по сайту.
 *
 * ПОЧЕМУ КОНТЕКСТ. Средняя стоит в строке значков рядом с рейтингом TMDB/
 * Shikimori, а кнопка оценки — в ряду действий, ниже. Страница серверная,
 * и без общего состояния после оценки средняя оставалась бы старой до
 * перезагрузки; router.refresh() ради одной цифры перезапросил бы у страницы
 * кино все внешние источники заново.
 */

interface State {
  contentType: ContentType;
  shikimoriId: number;
  userId: string;
  title: string;
  posterUrl: string | null;
  myScore: number | null;
  site: SiteRating | null;
  setMyScore: (score: number | null) => void;
  setSite: (site: SiteRating | null) => void;
}

const TitleRatingContext = createContext<State | null>(null);

function useTitleRating(): State {
  const value = useContext(TitleRatingContext);
  if (!value) throw new Error('TitleRating: компонент вне TitleRatingProvider');
  return value;
}

export function TitleRatingProvider({
  contentType,
  shikimoriId,
  userId,
  title,
  posterUrl,
  initialScore,
  initialSite,
  children,
}: {
  contentType: ContentType;
  shikimoriId: number;
  userId: string;
  title: string;
  posterUrl: string | null;
  initialScore: number | null;
  initialSite: SiteRating | null;
  children: React.ReactNode;
}) {
  const [myScore, setMyScore] = useState(initialScore);
  const [site, setSite] = useState(initialSite);
  const value = useMemo(
    () => ({ contentType, shikimoriId, userId, title, posterUrl, myScore, site, setMyScore, setSite }),
    [contentType, shikimoriId, userId, title, posterUrl, myScore, site],
  );
  return <TitleRatingContext.Provider value={value}>{children}</TitleRatingContext.Provider>;
}

function votesLabel(votes: number): string {
  const mod10 = votes % 10;
  const mod100 = votes % 100;
  if (mod10 === 1 && mod100 !== 11) return `${votes} оценка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${votes} оценки`;
  return `${votes} оценок`;
}

/** Значок средней по сайту — в строке рядом с внешним рейтингом. */
export function SiteRatingChip() {
  const { site } = useTitleRating();
  if (!site || site.votes === 0) return null;
  return (
    // Цифры — светлым, акцент — только значку. Акцент пользователь выбирает
    // сам, и мелкий текст его цветом на тёмной подложке проваливает контраст:
    // замерено у фиолетового #bf5af2 на этой подложке 4.41:1 при норме 4.5.
    <span
      className="relative inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 font-semibold text-gray-100"
      title="Средняя оценка пользователей MediaWatch"
    >
      <UsersIcon className="h-3.5 w-3.5 text-accent-text" />
      <span>
        {site.average.toFixed(1)}
        <span className="sr-only"> из 10 у зрителей MediaWatch,</span>
      </span>
      <span className="font-normal text-gray-300">· {votesLabel(site.votes)}</span>
    </span>
  );
}

// Вдвое компактнее, чем было (280px, ячейки 44px): та же цель, что у
// ListButton — панель не должна быть заметно крупнее соседних меню сайта.
const PANEL_WIDTH = 216;
const EDGE_GAP = 12;

// Подписи к баллам — те же, что у Shikimori: зрители аниме к ним привыкли.
const SCORE_LABELS: Record<number, string> = {
  1: 'Хуже некуда',
  2: 'Ужасно',
  3: 'Плохо',
  4: 'Не очень',
  5: 'Нормально',
  6: 'Неплохо',
  7: 'Хорошо',
  8: 'Отлично',
  9: 'Великолепно',
  10: 'Шедевр',
};

/** Кнопка «Оценить» с выбором балла 1–10 — в ряду действий страницы. */
export function RatingControl() {
  const { contentType, shikimoriId, userId, title, posterUrl, myScore, setMyScore, setSite } =
    useTitleRating();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [panelLeft, setPanelLeft] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Закрытие по клику вовне и по Escape — тот же приём, что в ListButton.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    // Фокус — внутрь панели, на текущий балл (или первый): иначе с
    // клавиатуры панель открывалась «где-то рядом», и скринридер не узнавал,
    // что появился выбор.
    const target =
      panelRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      panelRef.current?.querySelector<HTMLButtonElement>('button');
    target?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function refreshSite() {
    const { data } = await createClient().rpc('title_rating_summary', {
      p_content_type: contentType,
      p_ids: [shikimoriId],
    });
    const row = (data as { average: number | string; votes: number }[] | null)?.[0];
    setSite(row ? { average: Number(row.average), votes: row.votes } : null);
  }

  async function choose(next: number | null) {
    setOpen(false);
    triggerRef.current?.focus();
    if (next === myScore) return;
    const previous = myScore;
    setMyScore(next);
    setSaving(true);
    const supabase = createClient();
    try {
      if (next === null) {
        const { error } = await supabase
          .from('title_ratings')
          .delete()
          .eq('content_type', contentType)
          .eq('shikimori_id', shikimoriId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('title_ratings').upsert(
          {
            user_id: userId,
            content_type: contentType,
            shikimori_id: shikimoriId,
            score: next,
            anime_title: title,
            poster_url: posterUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,content_type,shikimori_id' },
        );
        if (error) throw error;
      }
      await refreshSite();
    } catch {
      setMyScore(previous);
      toast('Не удалось сохранить оценку. Попробуйте ещё раз.', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Панель прижата к левому краю кнопки, но не вылезает за окно: в ряду
  // действий кнопка на телефоне часто оказывается у правого края, и панель
  // шириной 280px уезжала бы за экран, давая странице горизонтальную прокрутку.
  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE_GAP);
      const left = Math.max(EDGE_GAP, Math.min(rect.left, window.innerWidth - EDGE_GAP - width));
      setPanelLeft(left - rect.left);
    }
    setOpen((v) => !v);
  }

  const shown = preview ?? myScore;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={saving}
        className={[
          'press flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition',
          myScore !== null
            ? 'border-accent/60 bg-accent/10 text-gray-100 hover:bg-accent/15'
            : 'border-white/10 bg-bg-card text-gray-100 hover:bg-bg-soft',
        ].join(' ')}
      >
        <StarIcon className={`h-4 w-4 ${myScore !== null ? 'text-accent-text' : ''}`} filled={myScore !== null} />
        <span>{myScore !== null ? `Ваша оценка: ${myScore}` : 'Оценить'}</span>
        <ChevronDownIcon className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Оценка тайтла"
          style={{ left: panelLeft, width: PANEL_WIDTH }}
          className="glass-panel absolute z-20 mt-2 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 p-2 shadow-2xl"
        >
          <div
            className="grid grid-cols-5 gap-1"
            onMouseLeave={() => setPreview(null)}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((score) => {
              const active = shown !== null && score <= shown;
              return (
                <button
                  key={score}
                  type="button"
                  onClick={() => choose(score)}
                  onMouseEnter={() => setPreview(score)}
                  onFocus={() => setPreview(score)}
                  onBlur={() => setPreview(null)}
                  aria-pressed={myScore === score}
                  aria-label={`${score} из 10 — ${SCORE_LABELS[score]}`}
                  className={[
                    'grid h-8 place-items-center rounded-lg text-xs font-semibold tabular-nums transition',
                    active ? 'bg-accent text-accent-fg' : 'bg-white/5 text-gray-200 hover:bg-white/10',
                  ].join(' ')}
                >
                  {score}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 h-4 text-center text-xs text-gray-300" aria-live="polite">
            {shown !== null ? SCORE_LABELS[shown] : 'Выберите балл'}
          </p>
          {myScore !== null && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="mt-1 w-full rounded-lg px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10"
            >
              Убрать оценку
            </button>
          )}
        </div>
      )}
    </div>
  );
}
