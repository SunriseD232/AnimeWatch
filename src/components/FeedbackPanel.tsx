'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_SECTIONS,
  feedbackSectionLabel,
  isFeedbackSection,
  type FeedbackMessageView,
  type FeedbackThreadView,
} from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';

/**
 * Обратная связь в профиле (миграция 0066). Один компонент на две роли:
 *   • mode="user"  — «Обратная связь»: новое обращение (раздел + текст) и
 *     свои переписки с ответами администратора;
 *   • mode="admin" — «Обращения»: ящик всех переписок, ответ и закрытие.
 * Пишет /api/feedback; уведомления в колокольчик ставит сервер.
 */
export default function FeedbackPanel({
  mode,
  initialThreads,
  initialThreadId = null,
  initialSection = null,
}: {
  mode: 'user' | 'admin';
  initialThreads: FeedbackThreadView[];
  initialThreadId?: string | null;
  initialSection?: string | null;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [openId, setOpenId] = useState<string | null>(
    initialThreadId && initialThreads.some((t) => t.id === initialThreadId)
      ? initialThreadId
      : mode === 'admin'
        ? (initialThreads[0]?.id ?? null)
        : null,
  );
  const [showClosed, setShowClosed] = useState(false);

  const open = threads.find((t) => t.id === openId) ?? null;

  // Открыли непрочитанное — отмечаем прочитанным (у себя и на сервере).
  useEffect(() => {
    if (!open?.unread) return;
    setThreads((list) => list.map((t) => (t.id === open.id ? { ...t, unread: false } : t)));
    void fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: open.id, action: 'read' }),
    }).catch(() => undefined);
  }, [open?.id, open?.unread]);

  const appendMessage = (threadId: string, message: FeedbackMessageView) =>
    setThreads((list) =>
      list
        .map((t) =>
          t.id === threadId
            ? { ...t, status: 'open' as const, lastMessageAt: message.createdAt, messages: [...t.messages, message] }
            : t,
        )
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    );

  const setStatus = async (threadId: string, status: 'open' | 'closed') => {
    const res = await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action: status === 'closed' ? 'close' : 'reopen' }),
    });
    if (res.ok) setThreads((list) => list.map((t) => (t.id === threadId ? { ...t, status } : t)));
  };

  const visible = mode === 'admin' && !showClosed ? threads.filter((t) => t.status === 'open' || t.id === openId) : threads;

  return (
    <div className="flex flex-col gap-5">
      {mode === 'user' ? (
        <>
          <p className="max-w-2xl text-sm text-gray-400">
            Что-то работает не так, не нашли нужного или есть идея? Напишите — ответ придёт сюда и в
            колокольчик. Новые разделы (подкасты, аудиокниги, книги, ранобэ, манга) ещё обкатываются,
            и любое сообщение о сбое нам очень поможет.
          </p>
          <NewThreadForm
            initialSection={isFeedbackSection(initialSection) ? initialSection : 'site'}
            onCreated={(thread) => {
              setThreads((list) => [thread, ...list]);
              setOpenId(thread.id);
            }}
          />
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-400">
            Открытых: {threads.filter((t) => t.status === 'open').length} · непрочитанных:{' '}
            {threads.filter((t) => t.unread).length}
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Показывать закрытые
          </label>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-bg-card p-6 text-sm text-gray-400 ring-1 ring-inset ring-white/5">
          {mode === 'admin' ? 'Открытых обращений нет.' : 'Вы пока ничего нам не писали.'}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1">
            {visible.map((t) => {
              const last = t.messages[t.messages.length - 1];
              const active = t.id === openId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(t.id)}
                    aria-current={active ? 'true' : undefined}
                    className={[
                      'press flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition',
                      active ? 'bg-accent/15 ring-1 ring-inset ring-accent/40' : 'bg-bg-card hover:bg-bg-soft',
                    ].join(' ')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {mode === 'admin' && t.author ? t.author.name : feedbackSectionLabel(t.section)}
                      </span>
                      {t.unread ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Есть новое" />
                      ) : null}
                    </span>
                    <span className="text-xs text-gray-400">
                      {mode === 'admin' ? `${feedbackSectionLabel(t.section)} · ` : ''}
                      {t.status === 'closed' ? 'закрыто · ' : ''}
                      {formatDateTime(t.lastMessageAt)}
                    </span>
                    {last ? (
                      <span className="line-clamp-1 text-xs text-gray-500">
                        {last.fromAdmin ? 'Админ: ' : ''}
                        {last.body}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {open ? (
            <ThreadChat
              key={open.id}
              thread={open}
              mode={mode}
              onSent={(m) => appendMessage(open.id, m)}
              onStatus={(s) => void setStatus(open.id, s)}
            />
          ) : (
            <p className="hidden rounded-2xl bg-bg-card p-6 text-sm text-gray-400 ring-1 ring-inset ring-white/5 md:block">
              Выберите обращение слева.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NewThreadForm({
  initialSection,
  onCreated,
}: {
  initialSection: string;
  onCreated: (thread: FeedbackThreadView) => void;
}) {
  const [section, setSection] = useState(initialSection);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, body: text }),
      });
      const data = (await res.json()) as { threadId?: string; message?: FeedbackMessageView; error?: string };
      if (!res.ok || !data.threadId || !data.message) throw new Error(data.error ?? 'Не удалось отправить.');
      onCreated({
        id: data.threadId,
        section,
        status: 'open',
        createdAt: data.message.createdAt,
        lastMessageAt: data.message.createdAt,
        unread: false,
        author: null,
        messages: [data.message],
      });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-inset ring-white/5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Раздел</span>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="rounded-lg bg-bg-soft px-3 py-2 text-base text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-accent sm:text-sm"
        >
          {FEEDBACK_SECTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Сообщение</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={FEEDBACK_MAX_LENGTH}
          placeholder="Что случилось и где: страница, тайтл, что нажимали"
          className="rounded-lg bg-bg-soft px-3 py-2 text-base text-gray-100 ring-1 ring-white/10 placeholder:text-gray-500 focus:outline-none focus:ring-accent sm:text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!text.trim()}
        aria-busy={sending}
        className="press w-fit rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
      >
        {sending ? 'Отправляем…' : 'Отправить'}
      </button>
    </form>
  );
}

function ThreadChat({
  thread,
  mode,
  onSent,
  onStatus,
}: {
  thread: FeedbackThreadView;
  mode: 'user' | 'admin';
  onSent: (message: FeedbackMessageView) => void;
  onStatus: (status: 'open' | 'closed') => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [thread.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id, body: text }),
      });
      const data = (await res.json()) as { message?: FeedbackMessageView; error?: string };
      if (!res.ok || !data.message) throw new Error(data.error ?? 'Не удалось отправить.');
      onSent(data.message);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-inset ring-white/5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {feedbackSectionLabel(thread.section)}
            {thread.status === 'closed' ? ' · закрыто' : ''}
          </h3>
          {mode === 'admin' && thread.author ? (
            <p className="truncate text-xs text-gray-400">
              {thread.author.name}
              {thread.author.email ? ` · ${thread.author.email}` : ''}
            </p>
          ) : null}
        </div>
        {mode === 'admin' ? (
          <button
            type="button"
            onClick={() => onStatus(thread.status === 'open' ? 'closed' : 'open')}
            className="press rounded-full px-3 py-1 text-xs text-gray-300 ring-1 ring-white/15 hover:text-white"
          >
            {thread.status === 'open' ? 'Закрыть обращение' : 'Открыть снова'}
          </button>
        ) : null}
      </header>

      <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
        {thread.messages.map((m) => {
          // «Своё» — справа: у человека его сообщения, у админа — ответы админа.
          const mine = mode === 'admin' ? m.fromAdmin : !m.fromAdmin;
          return (
            <div key={m.id} className={`flex flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}>
              <div
                className={[
                  'max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere]',
                  mine ? 'bg-accent/20 text-gray-100' : 'bg-bg-soft text-gray-200',
                ].join(' ')}
              >
                {m.body}
              </div>
              <span className="px-1 text-[11px] text-gray-500">
                {m.fromAdmin ? 'Администратор · ' : mode === 'admin' ? 'Пользователь · ' : ''}
                {formatDateTime(m.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={FEEDBACK_MAX_LENGTH}
          aria-label={mode === 'admin' ? 'Ответ пользователю' : 'Сообщение администратору'}
          placeholder={mode === 'admin' ? 'Ответ пользователю' : 'Дописать в это обращение'}
          className="rounded-lg bg-bg-soft px-3 py-2 text-base text-gray-100 ring-1 ring-white/10 placeholder:text-gray-500 focus:outline-none focus:ring-accent sm:text-sm"
        />
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!text.trim()}
          aria-busy={sending}
          className="press w-fit rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
        >
          {sending ? 'Отправляем…' : mode === 'admin' ? 'Ответить' : 'Отправить'}
        </button>
      </form>
    </section>
  );
}
