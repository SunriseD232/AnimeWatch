'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Avatar from '@/components/social/Avatar';
import { SendIcon, UsersIcon } from '@/components/social/icons';
import { useToast } from '@/components/ToastProvider';
import type { ContentType } from '@/lib/types';
import { PARTY_CHAT_MAX_LENGTH, PARTY_MAX_MEMBERS } from '@/lib/party/types';
import { useWatchParty, useWatchPartyRoom } from './WatchPartyProvider';

interface Props {
  contentType: ContentType;
  shikimoriId: number;
  title: string;
  season: number;
  episode: number;
}

const secondaryBtn =
  'press inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-white/5';

/**
 * Блок «Смотреть вместе» под плеером. Страница показывает его, только когда
 * у тайтла есть «Наш плеер» — синхронизировать можно лишь то видео, которым
 * управляем мы сами (решение владельца сайта: без «мягкого» режима для
 * чужих iframe-плееров).
 */
export default function WatchPartyPanel({ contentType, shikimoriId, title, season, episode }: Props) {
  const { party, creating, create, leave, inviteUrl, isPartyTitle } = useWatchParty();

  if (!party) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg-card px-4 py-3 ring-1 ring-white/5">
        <p className="text-sm text-gray-300">Смотрите эту серию вместе с друзьями — пауза и перемотка у всех сразу.</p>
        <button
          type="button"
          disabled={creating}
          aria-busy={creating}
          onClick={() => void create({ contentType, shikimoriId, title, season, episode })}
          className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          {creating ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          ) : (
            <UsersIcon className="h-4 w-4" />
          )}
          Смотреть вместе
        </button>
      </div>
    );
  }

  if (!isPartyTitle(contentType, shikimoriId)) {
    // Комната открыта для другого тайтла — не теряем её молча.
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg-card px-4 py-3 ring-1 ring-white/5">
        <p className="text-sm text-gray-300">
          Вы в комнате совместного просмотра «{party.title}».
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/party/${party.id}`} className={secondaryBtn}>
            Вернуться в комнату
          </Link>
          <button type="button" onClick={() => void leave()} className={secondaryBtn}>
            Выйти
          </button>
        </div>
      </div>
    );
  }

  return <PartyRoom inviteUrl={inviteUrl} onLeave={() => void leave()} />;
}

function PartyRoom({ inviteUrl, onLeave }: { inviteUrl: string | null; onLeave: () => void }) {
  const { members, messages, me, connected, sendChat } = useWatchPartyRoom();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const headingId = useId();
  const inputId = useId();

  // Новое сообщение — прокручиваем ленту вниз, но только саму ленту, не страницу.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Смотрим вместе', url: inviteUrl });
        return;
      }
      await navigator.clipboard.writeText(inviteUrl);
      toast('Ссылка скопирована — отправьте её друзьям', 'success');
    } catch {
      // Отменили системное «Поделиться» или нет доступа к буферу — молча.
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft('');
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id={headingId} className="text-lg font-semibold text-gray-100">
            Смотрим вместе
          </h2>
          <span className="text-sm text-gray-400">
            {connected ? `${members.length} из ${PARTY_MAX_MEMBERS}` : 'подключаемся…'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copyInvite()} className={secondaryBtn}>
            Пригласить
          </button>
          <button type="button" onClick={onLeave} className={secondaryBtn}>
            Выйти
          </button>
        </div>
      </header>

      <ul aria-label="Кто смотрит" className="flex flex-wrap gap-2">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3">
            <Avatar user={m} size="xs" />
            <span className="max-w-[10rem] truncate text-sm text-gray-200">
              {m.name}
              {m.userId === me?.userId ? ' (вы)' : ''}
            </span>
          </li>
        ))}
      </ul>

      <ul
        ref={listRef}
        aria-label="Чат комнаты"
        aria-live="polite"
        className="flex max-h-56 min-h-[3rem] flex-col gap-2 overflow-y-auto rounded-xl bg-white/5 p-3"
      >
        {messages.length === 0 ? (
          <li className="text-sm text-gray-400">Сообщения видны только тем, кто сейчас в комнате, и нигде не сохраняются.</li>
        ) : (
          messages.map((msg) => (
            <li key={msg.id} className="text-sm leading-relaxed [overflow-wrap:anywhere]">
              <span className="font-medium text-gray-100">{msg.name}</span>
              <span className="text-gray-300">: {msg.text}</span>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Сообщение в чат комнаты
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={PARTY_CHAT_MAX_LENGTH}
          placeholder="Написать в чат"
          autoComplete="off"
          enterKeyHint="send"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-bg-soft px-3 py-2.5 text-base text-gray-100 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:text-sm"
        />
        <button
          type="submit"
          disabled={!draft.trim() || !connected}
          aria-label="Отправить"
          className="press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
