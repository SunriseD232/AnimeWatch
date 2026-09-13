'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import {
  COMMENT_MAX_LENGTH,
  type CommentThread,
  type EpisodeComment,
} from '@/lib/social/types';
import type { ContentType } from '@/lib/types';
import Avatar from './Avatar';
import { ChevronDownIcon, MessageIcon, PencilIcon, ReplyIcon, SendIcon, TrashIcon } from './icons';

/**
 * Обсуждение конкретной серии — под плеером, с ответами деревом.
 *
 * Серию получает пропами от плеера (activeSeason/activeEpisode), а не из
 * адреса: WatchPlayer и Player переключают серии без навигации, и блок,
 * привязанный к URL-параметру страницы, остался бы на первой открытой серии.
 * Ответ на запрос прошлой серии, пришедший позже, отбрасывается
 * (AbortController и сверка ключа), иначе под серией 5 мелькнули бы
 * комментарии серии 4.
 *
 * ОТВЕТЫ И ВЕС СТРАНИЦЫ. Сервер отдаёт верхние комментарии страницами и у
 * каждого — число ответов. Короткие ветки (до трёх ответов) приходят сразу
 * раскрытыми, длинные — свёрнутыми «Показать N ответов» и догружаются только
 * по клику. Сотня ответов под популярным комментарием не тянется, пока её не
 * попросили, и не растягивает страницу на экраны.
 *
 * ГЛУБИНА. Отступ растёт только до MAX_INDENT уровней: дальше ветка
 * продолжается на том же уровне с подписью «в ответ Имя». Иначе на телефоне
 * к пятому ответу текст ужимался бы до столбика в пару слов.
 */

interface Props {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  /** Подпись серии — «Серия 4», «Сезон 2, серия 4»; null у фильма. */
  label: string | null;
  /** Название и постер тайтла — чтобы комментарий узнавался вне страницы
   *  серии: в «Моих комментариях» и в уведомлении об ответе. */
  title: string;
  posterUrl: string | null;
}

type LoadState = 'loading' | 'ready' | 'error';

interface ThreadState extends CommentThread {
  expanded: boolean;
  /** Все ли ответы ветки уже на клиенте. */
  complete: boolean;
  loadingReplies: boolean;
}

const MAX_INDENT = 2;
const FOCUS_HIGHLIGHT_MS = 4_000;

function pluralComments(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} комментарий`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} комментария`;
  return `${n} комментариев`;
}

function pluralReplies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ответ`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ответа`;
  return `${n} ответов`;
}

function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return formatDateTime(iso);
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

const textareaClass =
  'w-full resize-y rounded-xl border border-white/10 bg-bg-soft px-3 py-2.5 text-sm leading-relaxed text-gray-100 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

/** Комментарий, на который пришли по ссылке (?comment=), — один раз за жизнь блока. */
function readFocusFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('comment');
}

function toThreadState(t: CommentThread): ThreadState {
  const complete = t.replies.length >= t.replyCount;
  return { ...t, complete, expanded: t.replies.length > 0 && complete, loadingReplies: false };
}

export default function EpisodeComments({
  contentType,
  shikimoriId,
  season,
  episode,
  label,
  title,
  posterUrl,
}: Props) {
  const [threads, setThreads] = useState<ThreadState[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const threadKey = `${contentType}:${shikimoriId}:${season}:${episode}`;
  const threadKeyRef = useRef(threadKey);
  threadKeyRef.current = threadKey;
  const focusRef = useRef<string | null>(readFocusFromUrl());

  // Черновики — свои у каждой серии и у каждого ответа. Общий переезжал бы
  // вместе с человеком на следующую серию (плеер переключает их сам), и
  // мысль о серии 11 уходила бы под серию 12.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = (replyTo: string | null) => (replyTo ? `reply:${replyTo}` : threadKey);
  const draft = drafts[draftKey(null)] ?? '';
  const setDraftFor = (key: string, value: string) => setDrafts((prev) => ({ ...prev, [key]: value }));

  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();

  const baseQuery = `type=${contentType}&id=${shikimoriId}&season=${season}&episode=${episode}`;

  useEffect(() => {
    const controller = new AbortController();
    const focus = focusRef.current;
    setState('loading');
    setThreads([]);
    setTotal(0);
    setHasMore(false);
    setFormError(null);
    setReplyingTo(null);
    const url = `/api/comments?${baseQuery}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'load failed'));
        return res.json();
      })
      .then(
        (data: {
          threads: CommentThread[];
          hasMore: boolean;
          total: number | null;
          focus: { commentId: string; rootId: string } | null;
        }) => {
          // Ветку из ссылки раскрываем всегда, даже длинную: за ней и пришли.
          setThreads(
            data.threads.map((t) => {
              const next = toThreadState(t);
              return data.focus && t.comment.id === data.focus.rootId ? { ...next, expanded: true } : next;
            }),
          );
          setHasMore(data.hasMore);
          setTotal(data.total ?? 0);
          setNow(Date.now());
          setState('ready');
          if (data.focus) setHighlighted(data.focus.commentId);
          focusRef.current = null;
        },
      )
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('[comments] load failed', err);
        setState('error');
      });
    return () => controller.abort();
  }, [baseQuery, reloadKey]);

  // Прокрутка к комментарию из ссылки или к только что отправленному ответу,
  // и короткая подсветка, чтобы глаз его нашёл.
  useEffect(() => {
    if (!highlighted || state !== 'ready') return;
    const el = document.getElementById(`comment-${highlighted}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => setHighlighted(null), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted, state]);

  // «5 мин назад» не должно застывать, пока человек смотрит серию.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadMore = useCallback(async () => {
    const last = threads[threads.length - 1];
    if (!last) return;
    const key = threadKeyRef.current;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/comments?${baseQuery}&before=${encodeURIComponent(last.comment.createdAt)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(await readError(res, 'load failed'));
      const data = (await res.json()) as { threads: CommentThread[]; hasMore: boolean };
      if (threadKeyRef.current !== key) return;
      setThreads((prev) => [
        ...prev,
        ...data.threads.filter((t) => !prev.some((p) => p.comment.id === t.comment.id)).map(toThreadState),
      ]);
      setHasMore(data.hasMore);
    } catch {
      setFormError('Не удалось загрузить старые комментарии. Попробуйте ещё раз.');
    } finally {
      setLoadingMore(false);
    }
  }, [baseQuery, threads]);

  const loadReplies = useCallback(async (rootId: string) => {
    const key = threadKeyRef.current;
    setThreads((prev) => prev.map((t) => (t.comment.id === rootId ? { ...t, loadingReplies: true } : t)));
    let collected: EpisodeComment[] = [];
    let after: string | null = null;
    try {
      // Догружаем ветку целиком, страницами: ветка с обрывом посередине
      // разговора читается хуже, чем свёрнутая.
      for (let page = 0; page < 20; page++) {
        const res: Response = await fetch(
          `/api/comments/replies?root=${rootId}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(await readError(res, 'load failed'));
        const data = (await res.json()) as { replies: EpisodeComment[]; hasMore: boolean };
        collected = [...collected, ...data.replies];
        if (!data.hasMore || data.replies.length === 0) break;
        after = data.replies[data.replies.length - 1].createdAt;
      }
      if (threadKeyRef.current !== key) return;
      setThreads((prev) =>
        prev.map((t) =>
          t.comment.id === rootId
            ? {
                ...t,
                replies: collected,
                replyCount: collected.filter((r) => !r.deleted).length,
                complete: true,
                expanded: true,
                loadingReplies: false,
              }
            : t,
        ),
      );
    } catch {
      if (threadKeyRef.current !== key) return;
      setThreads((prev) => prev.map((t) => (t.comment.id === rootId ? { ...t, loadingReplies: false } : t)));
      setFormError('Не удалось загрузить ответы. Попробуйте ещё раз.');
    }
  }, []);

  async function post(text: string, parent: EpisodeComment | null): Promise<boolean> {
    const body = text.trim();
    if (body.length === 0 || posting) return false;
    const key = threadKeyRef.current;
    const dKey = draftKey(parent?.id ?? null);
    setPosting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: contentType,
          id: shikimoriId,
          season,
          episode,
          body,
          parentId: parent?.id ?? null,
          title,
          poster: posterUrl,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось отправить. Попробуйте ещё раз.'));
      const data = (await res.json()) as { comment: EpisodeComment };
      // Черновик чистим в любом случае — комментарий ушёл, даже если человек
      // успел переключиться на другую серию.
      setDrafts((prev) => ({ ...prev, [dKey]: '' }));
      if (threadKeyRef.current !== key) return true;
      setTotal((n) => n + 1);
      setNow(Date.now());
      if (!parent) {
        setThreads((prev) => [
          { comment: data.comment, replyCount: 0, replies: [], expanded: false, complete: true, loadingReplies: false },
          ...prev,
        ]);
      } else {
        const rootId = parent.rootId ?? parent.id;
        const thread = threads.find((t) => t.comment.id === rootId);
        setReplyingTo(null);
        if (thread && !thread.complete) {
          await loadReplies(rootId);
        } else {
          setThreads((prev) =>
            prev.map((t) =>
              t.comment.id === rootId
                ? { ...t, replies: [...t.replies, data.comment], replyCount: t.replyCount + 1, expanded: true }
                : t,
            ),
          );
        }
        setHighlighted(data.comment.id);
      }
      return true;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Не удалось отправить. Попробуйте ещё раз.');
      return false;
    } finally {
      setPosting(false);
    }
  }

  function replaceComment(next: EpisodeComment) {
    setThreads((prev) =>
      prev.map((t) =>
        t.comment.id === next.id
          ? { ...t, comment: next }
          : { ...t, replies: t.replies.map((r) => (r.id === next.id ? next : r)) },
      ),
    );
  }

  function applyDeletion(target: EpisodeComment, mode: 'soft' | 'hard') {
    setTotal((n) => Math.max(0, n - 1));
    const tombstone = (c: EpisodeComment): EpisodeComment => ({
      ...c,
      body: '',
      deleted: true,
      mine: false,
      canDelete: false,
    });

    setThreads((prev) =>
      prev.flatMap((t) => {
        if (t.comment.id === target.id) {
          return mode === 'soft' ? [{ ...t, comment: tombstone(t.comment) }] : [];
        }
        if ((target.rootId ?? target.id) !== t.comment.id) return [t];

        let replies =
          mode === 'soft'
            ? t.replies.map((r) => (r.id === target.id ? tombstone(r) : r))
            : t.replies.filter((r) => r.id !== target.id);
        // Та же уборка заглушек, что делает сервер: удалённый без ответов
        // больше ничего не держит.
        for (;;) {
          const next = replies.filter((r) => !(r.deleted && !replies.some((child) => child.parentId === r.id)));
          if (next.length === replies.length) break;
          replies = next;
        }
        const rootGone = t.comment.deleted && !replies.some((r) => r.parentId === t.comment.id);
        if (rootGone) return [];
        return [{ ...t, replies, replyCount: Math.max(0, t.replyCount - 1) }];
      }),
    );
  }

  const remaining = COMMENT_MAX_LENGTH - draft.length;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-gray-100">
          Обсуждение
          {label && (
            <>
              {' '}
              <span className="text-base font-medium text-gray-400">{label}</span>
            </>
          )}
        </h2>
        {state === 'ready' && total > 0 && <span className="text-sm text-gray-400">{pluralComments(total)}</span>}
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void post(draft, null);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={fieldId} className="sr-only">
          Ваш комментарий
        </label>
        <textarea
          id={fieldId}
          value={draft}
          onChange={(e) => setDraftFor(draftKey(null), e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void post(draft, null);
            }
          }}
          rows={3}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Что думаете о серии? Про следующие серии лучше без спойлеров."
          aria-describedby={hintId}
          aria-invalid={formError ? true : undefined}
          className={textareaClass}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={hintId} className="text-xs text-gray-400">
            {remaining < 200 ? `Осталось ${remaining} символов` : 'Ctrl + Enter — отправить'}
          </p>
          <SubmitButton disabled={draft.trim().length === 0} busy={posting && replyingTo === null} />
        </div>
        {formError && (
          <p role="alert" className="text-sm text-red-300">
            {formError}
          </p>
        )}
      </form>

      {state === 'loading' && (
        <ul aria-label="Загружаем комментарии" className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <li key={i} className="flex gap-3">
              <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="skeleton h-4 w-32 rounded" />
                <div className="skeleton h-4 w-3/4 rounded" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {state === 'error' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm text-gray-300">
          <span>Не удалось загрузить обсуждение.</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="press rounded-full border border-white/10 px-3 py-1.5 font-medium text-gray-100 transition hover:bg-white/5"
          >
            Повторить
          </button>
        </div>
      )}

      {state === 'ready' && threads.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-4 text-sm text-gray-300">
          <MessageIcon className="h-5 w-5 text-accent" />
          <span>
            {label ? 'Об этой серии пока никто не написал.' : 'Пока никто не написал.'} Поделитесь впечатлением
            первым.
          </span>
        </div>
      )}

      {state === 'ready' && threads.length > 0 && (
        <ul className="flex flex-col divide-y divide-white/5">
          {threads.map((thread) => (
            <ThreadView
              key={thread.comment.id}
              thread={thread}
              now={now}
              replyingTo={replyingTo}
              highlighted={highlighted}
              posting={posting}
              drafts={drafts}
              onDraft={setDraftFor}
              onReply={(c) => setReplyingTo((cur) => (cur === c.id ? null : c.id))}
              onCancelReply={() => setReplyingTo(null)}
              onPostReply={(text, parent) => post(text, parent)}
              onToggle={() => {
                if (!thread.expanded && !thread.complete) {
                  void loadReplies(thread.comment.id);
                } else {
                  setThreads((prev) =>
                    prev.map((t) => (t.comment.id === thread.comment.id ? { ...t, expanded: !t.expanded } : t)),
                  );
                }
              }}
              onChanged={replaceComment}
              onDeleted={applyDeletion}
            />
          ))}
        </ul>
      )}

      {state === 'ready' && hasMore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          aria-busy={loadingMore}
          className="press self-center rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-white/5"
        >
          {loadingMore ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
}

function SubmitButton({ disabled, busy, label = 'Отправить' }: { disabled: boolean; busy: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-busy={busy}
      className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        <SendIcon className="h-4 w-4" />
      )}
      {busy ? 'Отправляем' : label}
    </button>
  );
}

interface ThreadViewProps {
  thread: ThreadState;
  now: number;
  replyingTo: string | null;
  highlighted: string | null;
  posting: boolean;
  drafts: Record<string, string>;
  onDraft: (key: string, value: string) => void;
  onReply: (c: EpisodeComment) => void;
  onCancelReply: () => void;
  onPostReply: (text: string, parent: EpisodeComment) => Promise<boolean>;
  onToggle: () => void;
  onChanged: (next: EpisodeComment) => void;
  onDeleted: (target: EpisodeComment, mode: 'soft' | 'hard') => void;
}

function ThreadView(props: ThreadViewProps) {
  const { thread, onToggle } = props;
  const children = new Map<string, EpisodeComment[]>();
  const byId = new Map<string, EpisodeComment>([[thread.comment.id, thread.comment]]);
  for (const r of thread.replies) {
    byId.set(r.id, r);
    const key = r.parentId ?? thread.comment.id;
    children.set(key, [...(children.get(key) ?? []), r]);
  }

  const renderBranch = (parentId: string, depth: number): React.ReactNode =>
    (children.get(parentId) ?? []).map((reply) => {
      const parent = byId.get(parentId);
      const kids = children.get(reply.id) ?? [];
      return (
        <Fragment key={reply.id}>
          <CommentNode
            {...props}
            comment={reply}
            compact
            // За пределом отступа ветка идёт тем же уровнем, и связь «кому
            // ответ» держит подпись, а не лесенка.
            replyToName={depth > MAX_INDENT && parent && !parent.deleted ? parent.author.name : null}
          />
          {kids.length > 0 &&
            (depth < MAX_INDENT ? (
              <div className="ml-4 border-l border-white/10 pl-3 sm:ml-5 sm:pl-4">
                {renderBranch(reply.id, depth + 1)}
              </div>
            ) : (
              renderBranch(reply.id, depth + 1)
            ))}
        </Fragment>
      );
    });

  const collapsed = thread.replyCount > 0 && !thread.expanded;

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <CommentNode {...props} comment={thread.comment} compact={false} replyToName={null} />
      {thread.expanded && thread.replies.length > 0 && (
        <div className="ml-5 mt-2 border-l border-white/10 pl-3 sm:ml-12 sm:pl-4">
          {renderBranch(thread.comment.id, 1)}
        </div>
      )}
      {thread.replyCount > 0 && (
        <div className="ml-10 mt-1 sm:ml-[3.25rem]">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={thread.expanded}
            aria-busy={thread.loadingReplies}
            className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-gray-300 transition hover:bg-white/5 hover:text-gray-100"
          >
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${thread.expanded ? 'rotate-180' : ''}`} />
            {thread.loadingReplies
              ? 'Загружаем ответы…'
              : collapsed
                ? `Показать ${pluralReplies(thread.replyCount)}`
                : 'Скрыть ответы'}
          </button>
        </div>
      )}
    </li>
  );
}

function CommentNode({
  comment,
  compact,
  replyToName,
  now,
  replyingTo,
  highlighted,
  posting,
  drafts,
  onDraft,
  onReply,
  onCancelReply,
  onPostReply,
  onChanged,
  onDeleted,
}: ThreadViewProps & { comment: EpisodeComment; compact: boolean; replyToName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editId = useId();
  const replyId = useId();

  const replyKey = `reply:${comment.id}`;
  const replyDraft = drafts[replyKey] ?? '';
  const isReplying = replyingTo === comment.id;

  async function save() {
    const next = text.trim();
    if (next.length === 0 || busy) return;
    if (next === comment.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: next }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось сохранить правку.'));
      const data = (await res.json()) as { comment: EpisodeComment };
      onChanged(data.comment);
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
      if (res.status === 404) {
        onDeleted(comment, 'hard');
        return;
      }
      if (!res.ok) throw new Error(await readError(res, 'Не удалось удалить.'));
      const data = (await res.json()) as { mode: 'soft' | 'hard' };
      onDeleted(comment, data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить.');
      setBusy(false);
      setConfirming(false);
    }
  }

  const { author } = comment;
  const isHighlighted = highlighted === comment.id;

  return (
    <div
      id={`comment-${comment.id}`}
      className={[
        '-mx-2 flex scroll-mt-24 gap-3 rounded-xl px-2 transition-colors duration-700',
        compact ? 'py-2.5' : '',
        isHighlighted ? 'bg-accent/10 ring-1 ring-accent/40' : '',
      ].join(' ')}
    >
      {comment.deleted ? (
        <span aria-hidden="true" className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} shrink-0 rounded-full bg-white/5`} />
      ) : (
        <Link href={`/u/${author.id}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
          <Avatar user={author} size={compact ? 'sm' : 'md'} />
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {comment.deleted ? (
          <p className="py-1 text-sm italic text-gray-400">Комментарий удалён</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                href={`/u/${author.id}`}
                className="max-w-full truncate text-sm font-semibold text-gray-100 underline-offset-2 transition hover:text-white hover:underline"
              >
                {author.name}
              </Link>
              {replyToName && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <ReplyIcon className="h-3 w-3" />в ответ {replyToName}
                </span>
              )}
              <time
                dateTime={comment.createdAt}
                title={formatDateTime(comment.createdAt)}
                className="text-xs text-gray-400"
              >
                {relativeTime(comment.createdAt, now)}
                {comment.editedAt ? ' · изменён' : ''}
              </time>
            </div>

            {editing ? (
              <div className="flex flex-col gap-2">
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
                    if (e.key === 'Escape') {
                      setEditing(false);
                      setText(comment.body);
                    }
                  }}
                  rows={3}
                  maxLength={COMMENT_MAX_LENGTH}
                  autoFocus
                  className={textareaClass}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={text.trim().length === 0}
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
                      setError(null);
                    }}
                    className="press rounded-full border border-white/10 px-3.5 py-1.5 text-sm font-medium text-gray-200 transition hover:bg-white/5"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-200 [overflow-wrap:anywhere]">
                {comment.body}
              </p>
            )}

            {!editing && (
              <div className="-ml-2.5 mt-0.5 flex flex-wrap items-center gap-1 text-xs">
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
                    <button
                      type="button"
                      onClick={() => onReply(comment)}
                      aria-expanded={isReplying}
                      className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
                    >
                      <ReplyIcon className="h-3.5 w-3.5" />
                      Ответить
                    </button>
                    {comment.mine && (
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                        Изменить
                      </button>
                    )}
                    {comment.canDelete && (
                      <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        className="press inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        Удалить
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {isReplying && !comment.deleted && (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onPostReply(replyDraft, comment);
            }}
          >
            <label htmlFor={replyId} className="sr-only">
              Ответ {author.name}
            </label>
            <textarea
              id={replyId}
              value={replyDraft}
              onChange={(e) => onDraft(replyKey, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void onPostReply(replyDraft, comment);
                }
                if (e.key === 'Escape') onCancelReply();
              }}
              rows={2}
              maxLength={COMMENT_MAX_LENGTH}
              autoFocus
              placeholder={`Ответ ${author.name}`}
              className={textareaClass}
            />
            <div className="flex flex-wrap gap-2">
              <SubmitButton disabled={replyDraft.trim().length === 0} busy={posting} label="Ответить" />
              <button
                type="button"
                onClick={onCancelReply}
                className="press rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/5"
              >
                Отмена
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
