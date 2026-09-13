'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { fixPosterUrl, formatDateTime } from '@/lib/format';
import { COMMENT_MAX_LENGTH, commentHref, type MyComment } from '@/lib/social/types';
import { MessageIcon, PencilIcon, ReplyIcon, TrashIcon } from './icons';

/**
 * Вкладка «Комментарии» в профиле: всё, что человек написал по всему сайту,
 * с переходом к месту обсуждения, правкой и удалением.
 *
 * Грузится при открытии вкладки, а не вместе со страницей профиля: большая
 * часть заходов в профиль — за списком или историей, и тянуть ради них ещё
 * и комментарии незачем.
 */

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

function whereLabel(c: MyComment): string {
  if (c.contentType === 'cinema' && c.season > 1) return `Сезон ${c.season}, серия ${c.episode}`;
  return `Серия ${c.episode}`;
}

function pluralReplies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ответ`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ответа`;
  return `${n} ответов`;
}

export default function MyComments() {
  const [items, setItems] = useState<MyComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (before?: string) => {
    const res = await fetch(`/api/comments/mine${before ? `?before=${encodeURIComponent(before)}` : ''}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(await readError(res, 'load failed'));
    return (await res.json()) as { comments: MyComment[]; hasMore: boolean };
  }, []);

  const reload = useCallback(() => {
    setState('loading');
    load()
      .then((data) => {
        setItems(data.comments);
        setHasMore(data.hasMore);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [load]);

  useEffect(() => reload(), [reload]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await load(last.createdAt);
      setItems((prev) => [...prev, ...data.comments.filter((c) => !prev.some((p) => p.id === c.id))]);
      setHasMore(data.hasMore);
    } catch {
      // Кнопка остаётся — можно нажать ещё раз.
    } finally {
      setLoadingMore(false);
    }
  }

  if (state === 'loading') {
    return (
      <ul aria-label="Загружаем комментарии" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </ul>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg-card px-5 py-4 text-sm text-gray-300 ring-1 ring-white/5">
        <span>Не удалось загрузить комментарии.</span>
        <button
          type="button"
          onClick={reload}
          className="press rounded-full border border-white/10 px-3 py-1.5 font-medium text-gray-100 transition hover:bg-white/5"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
        <MessageIcon className="mt-0.5 h-5 w-5 text-accent-text" />
        <div>
          <p className="font-medium text-gray-100">Комментариев пока нет</p>
          <p className="mt-1">Обсуждение есть под плеером у каждой серии. Всё, что вы там напишете, соберётся здесь.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <MyCommentItem
            key={c.id}
            comment={c}
            onChanged={(next) => setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)))}
            onRemoved={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
          />
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          aria-busy={loadingMore}
          className="press self-center rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-white/5"
        >
          {loadingMore ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}

function MyCommentItem({
  comment,
  onChanged,
  onRemoved,
}: {
  comment: MyComment;
  onChanged: (next: MyComment) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editId = useId();
  const kind = comment.contentType === 'cinema' ? 'cinema' : 'anime';

  async function save() {
    const next = text.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: next }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось сохранить правку.'));
      const data = (await res.json()) as { comment: { body: string; editedAt: string | null } };
      onChanged({ ...comment, body: data.comment.body, editedAt: data.comment.editedAt });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить правку.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await readError(res, 'Не удалось удалить.'));
      onRemoved(comment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить.');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="flex gap-3 rounded-xl bg-bg-card p-3 ring-1 ring-white/5">
      <Link
        href={`/${kind}/${comment.shikimoriId}`}
        className="relative hidden h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-bg-soft sm:block"
        aria-label={comment.title ?? 'Тайтл'}
      >
        {comment.posterUrl && (
          <PosterImage
            sources={[fixPosterUrl(comment.posterUrl)]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            placeholderClassName="h-full w-full"
          />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link href={commentHref(comment)} className="min-w-0 truncate font-semibold text-gray-100 underline-offset-2 hover:underline">
            {comment.title ?? 'Без названия'}
          </Link>
          <span className="text-gray-400">{whereLabel(comment)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
          <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
          {comment.editedAt && <span>· изменён</span>}
          {comment.isReply && (
            <span className="inline-flex items-center gap-1">
              · <ReplyIcon className="h-3 w-3" /> ответ
            </span>
          )}
          {comment.replyCount > 0 && <span>· {pluralReplies(comment.replyCount)}</span>}
        </div>

        {editing ? (
          <div className="mt-1 flex flex-col gap-2">
            <label htmlFor={editId} className="sr-only">
              Текст комментария
            </label>
            <textarea
              id={editId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              rows={3}
              maxLength={COMMENT_MAX_LENGTH}
              autoFocus
              className="w-full resize-y rounded-xl border border-white/10 bg-bg-soft px-3 py-2.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!text.trim()}
                aria-busy={busy}
                className="press rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setText(comment.body);
                }}
                className="press rounded-full border border-white/10 px-3.5 py-1.5 text-sm font-medium text-gray-200 transition hover:bg-white/5"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <p className="line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-gray-200 [overflow-wrap:anywhere]">
            {comment.body}
          </p>
        )}

        {!editing && (
          <div className="-ml-2.5 flex flex-wrap items-center gap-1 text-xs">
            {confirming ? (
              <>
                <span className="ml-2.5 mr-1 text-gray-300">Удалить комментарий?</span>
                <button
                  type="button"
                  onClick={() => void remove()}
                  aria-busy={busy}
                  className="press rounded-full bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700"
                >
                  {busy ? 'Удаляем…' : 'Удалить'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="press rounded-full px-3 py-1.5 font-medium text-gray-300 transition hover:bg-white/5"
                >
                  Отмена
                </button>
              </>
            ) : (
              <>
                <Link
                  href={commentHref(comment)}
                  className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-gray-300 transition hover:bg-white/5 hover:text-gray-100"
                >
                  <MessageIcon className="h-3.5 w-3.5" />К обсуждению
                </Link>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Удалить
                </button>
              </>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
