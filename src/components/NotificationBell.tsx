'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '@/components/useAnchoredPanel';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import Avatar from '@/components/social/Avatar';
import { AlertIcon, BellOffIcon, ReplyIcon, UserCheckIcon, UserPlusIcon, XIcon } from '@/components/social/icons';
import { nameOf } from '@/lib/social/names';
import { commentHref } from '@/lib/social/types';
import type { AppNotification, EpisodeNotification, SocialNotification, SystemNotification } from '@/lib/types';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

type Section = 'episodes' | 'friends' | 'replies' | 'system';

const SECTION_LABELS: Record<Section, string> = {
  episodes: 'Серии',
  friends: 'Друзья',
  replies: 'Ответы',
  system: 'Система',
};

function sectionOf(n: AppNotification): Section {
  if (n.kind === 'episode') return 'episodes';
  if (n.kind === 'system') return 'system';
  return n.type === 'comment_reply' ? 'replies' : 'friends';
}

/** В какой таблице живёт уведомление этого вида — для прочтения и удаления. */
function tableFor(kind: AppNotification['kind']) {
  if (kind === 'episode') return 'episode_notifications';
  if (kind === 'social') return 'social_notifications';
  return 'system_notifications';
}

const EMPTY_TEXT: Record<Section, string> = {
  episodes: 'Новых серий нет. Уведомления приходят по тайтлам со статусом «Смотрю».',
  friends: 'Заявок в друзья нет.',
  replies: 'Ответов на ваши комментарии пока нет.',
  system: 'Системных уведомлений нет.',
};

/**
 * Колокольчик уведомлений, разложенный по разделам: новые серии, друзья
 * (заявки и принятые заявки), ответы на комментарии и — только админам —
 * системные.
 *
 * ЗАЧЕМ РАЗДЕЛЫ. С появлением социальных уведомлений в одном списке
 * смешались бы «вышла серия 12» и «Neko ответил вам»: у них разный вес и
 * разная срочность, и заявка в друзья терялась бы между десятком серий.
 * Раздел открывается тот, где есть непрочитанное.
 *
 * Начальный список приходит с сервера (Navbar), дальше — Realtime-подписка
 * на вставки во все три таблицы. У социальных ещё и на удаления: отозванная
 * заявка убирает своё уведомление триггером, и оно должно пропасть и здесь.
 */
export default function NotificationBell({ initial }: { initial: AppNotification[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => setItems(initial), [initial]);

  const unreadBySection = useMemo(() => {
    const map: Record<Section, number> = { episodes: 0, friends: 0, replies: 0, system: 0 };
    for (const n of items) if (!n.read_at) map[sectionOf(n)] += 1;
    return map;
  }, [items]);
  const unread = unreadBySection.episodes + unreadBySection.friends + unreadBySection.replies + unreadBySection.system;
  const hasSystem = items.some((n) => n.kind === 'system');
  const sections: Section[] = ['episodes', 'friends', 'replies', ...(hasSystem ? (['system'] as const) : [])];

  const pickSection = useCallback((): Section => {
    const withUnread = (['friends', 'replies', 'episodes', 'system'] as Section[]).find((s) => unreadBySection[s] > 0);
    return withUnread ?? 'episodes';
  }, [unreadBySection]);
  const [section, setSection] = useState<Section>('episodes');

  // Список кладём ПОД шапку, а не под кнопку. Колокольчик стоит внутри
  // шапки, и список, отсчитанный от него, начинался на несколько пикселей
  // выше её нижней границы — накладывался на собственную шапку. Позицию
  // меряем: высота шапки зависит от безопасной зоны устройства.
  const measure = useCallback(() => {
    const header = document.querySelector('header');
    const anchor = rootRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    setBox({
      top: (header ? header.getBoundingClientRect().bottom : a.bottom) + 8,
      right: Math.max(12, window.innerWidth - a.right),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open, measure]);

  // Закрытие по клику вовне и по Escape. panelRef обязателен: панель живёт
  // в <body>, и без него любой клик по ней самой считался бы внешним —
  // см. useDismissOnOutside.
  useDismissOnOutside(open, () => setOpen(false), rootRef, panelRef);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notif-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'episode_notifications' }, (payload) => {
        setItems((prev) => [{ ...(payload.new as Omit<EpisodeNotification, 'kind'>), kind: 'episode' }, ...prev]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_notifications' }, (payload) => {
        setItems((prev) => [{ ...(payload.new as Omit<SystemNotification, 'kind'>), kind: 'system' }, ...prev]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'social_notifications' }, async (payload) => {
        const row = payload.new as Record<string, unknown>;
        const actorId = typeof row.actor_id === 'string' ? row.actor_id : null;
        let actor: SocialNotification['actor'] = null;
        if (actorId) {
          const { data } = await supabase
            .from('profiles')
            .select('display_name, avatar_path')
            .eq('user_id', actorId)
            .maybeSingle();
          actor = { id: actorId, name: nameOf(data?.display_name, actorId), avatarUrl: data?.avatar_path ?? null };
        }
        const next: SocialNotification = {
          kind: 'social',
          id: String(row.id),
          user_id: String(row.user_id),
          type: row.kind as SocialNotification['type'],
          actor,
          comment_id: (row.comment_id as string | null) ?? null,
          content_type: (row.content_type as SocialNotification['content_type']) ?? null,
          shikimori_id: (row.shikimori_id as number | null) ?? null,
          season: (row.season as number | null) ?? null,
          episode: (row.episode as number | null) ?? null,
          title: (row.title as string | null) ?? null,
          snippet: (row.snippet as string | null) ?? null,
          created_at: String(row.created_at),
          read_at: null,
        };
        setItems((prev) => (prev.some((n) => n.id === next.id) ? prev : [next, ...prev]));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'social_notifications' }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (id) setItems((prev) => prev.filter((n) => n.id !== id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function markRead(notification: AppNotification) {
    if (notification.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read_at: now } : n)));
    await createClient().from(tableFor(notification.kind)).update({ read_at: now }).eq('id', notification.id);
  }

  /**
   * Убрать одно уведомление. Оптимистично: строка исчезает сразу, запрос
   * уходит следом — ждать ответа ради удаления мелочи из списка незачем.
   */
  async function dismiss(notification: AppNotification) {
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    const { error } = await createClient().from(tableFor(notification.kind)).delete().eq('id', notification.id);
    if (error) console.error('[NotificationBell] не удалилось:', error.message);
  }

  /** Больше не уведомлять про этот тайтл — флаг muted в user_list, как в ListButton. */
  async function mute(notification: EpisodeNotification) {
    const { error } = await createClient()
      .from('user_list')
      .update({ muted: true })
      .eq('content_type', notification.content_type)
      .eq('shikimori_id', notification.shikimori_id);
    if (error) {
      toast('Не удалось отписаться. Попробуйте ещё раз.', 'error');
      return;
    }
    await dismiss(notification);
    toast(`Больше не уведомляем: ${notification.title}`, 'success');
  }

  /** Ответ на заявку прямо из колокольчика — ради этого его обычно и открывают. */
  async function answerRequest(notification: SocialNotification, accept: boolean) {
    if (!notification.actor) return;
    const res = await fetch('/api/friends', {
      method: accept ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: notification.actor.id }),
    });
    if (!res.ok) {
      toast('Не получилось. Попробуйте ещё раз.', 'error');
      return;
    }
    // Само уведомление о заявке база уже убрала триггером — убираем и здесь.
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    toast(accept ? `${notification.actor.name} теперь в друзьях` : 'Заявка отклонена', 'success');
  }

  async function markSectionRead() {
    const unreadItems = items.filter((n) => !n.read_at && sectionOf(n) === section);
    if (unreadItems.length === 0) return;
    const now = new Date().toISOString();
    const ids = new Set(unreadItems.map((n) => n.id));
    setItems((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    const table = tableFor(unreadItems[0].kind);
    await createClient()
      .from(table)
      .update({ read_at: now })
      .in('id', [...ids]);
  }

  const visible = items.filter((n) => sectionOf(n) === section);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          // Замер ДО показа, а не в эффекте после: не спозиционированный
          // fixed-блок на первом кадре вылезал за край и сдвигал замер.
          if (!open) {
            measure();
            setSection(pickSection());
          }
          setOpen((v) => !v);
        }}
        aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
        aria-haspopup="dialog"
        aria-expanded={open}
        // На телефоне колокольчик ростом с поисковую строку (она py-2 при
        // text-base, то есть 42px); на широких экранах шапка плотнее.
        className="press relative grid h-[42px] w-[42px] place-items-center rounded-full text-gray-300 hover:bg-white/5 hover:text-white md:h-9 md:w-9"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6 md:h-5 md:w-5">
          <path
            d="M12 3a5 5 0 0 0-5 5v3.2c0 .5-.16 1-.46 1.4L5 15h14l-1.54-2.4c-.3-.4-.46-.9-.46-1.4V8a5 5 0 0 0-5-5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open &&
        box &&
        // Портал в body: внутри шапки панель размывала бы саму шапку, а не
        // страницу под собой (у элемента с backdrop-filter потомки видят его
        // собственный фон), и координаты считались бы от шапки.
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Уведомления"
            style={{ top: box.top, right: box.right }}
            className="glass-panel fixed z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 pt-3">
              <div
                role="tablist"
                aria-label="Разделы уведомлений"
                className="-mb-px flex min-w-0 gap-1 overflow-x-auto"
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!step) return;
                  e.preventDefault();
                  const index = sections.indexOf(section);
                  const next = sections[(index + step + sections.length) % sections.length];
                  setSection(next);
                  e.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
                }}
              >
                {sections.map((s) => {
                  const selected = s === section;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      data-section={s}
                      id={`notif-tab-${s}`}
                      aria-selected={selected}
                      aria-controls="notif-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setSection(s)}
                      className={[
                        'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2 pb-2.5 pt-1 text-sm font-semibold transition',
                        selected ? 'border-accent text-gray-100' : 'border-transparent text-gray-400 hover:text-gray-200',
                      ].join(' ')}
                    >
                      {SECTION_LABELS[s]}
                      {unreadBySection[s] > 0 && (
                        <span className="relative grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
                          {unreadBySection[s] > 9 ? '9+' : unreadBySection[s]}
                          <span className="sr-only"> непрочитанных</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {unreadBySection[section] > 0 && (
                <button
                  type="button"
                  onClick={markSectionRead}
                  className="mb-2 shrink-0 rounded-full px-2 py-1 text-xs font-medium text-gray-300 transition hover:bg-white/5 hover:text-gray-100"
                >
                  Прочитать
                </button>
              )}
            </div>

            <div id="notif-panel" role="tabpanel" aria-labelledby={`notif-tab-${section}`} className="max-h-96 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">{EMPTY_TEXT[section]}</p>
              ) : (
                visible.map((n) => (
                  <div key={n.id} className="group relative border-b border-white/5 last:border-b-0">
                    {n.kind === 'episode' && (
                      <EpisodeRow n={n} onOpen={() => { setOpen(false); void markRead(n); }} />
                    )}
                    {n.kind === 'system' && <SystemRow n={n} onOpen={() => void markRead(n)} />}
                    {n.kind === 'social' && (
                      <SocialRow
                        n={n}
                        onOpen={() => {
                          setOpen(false);
                          void markRead(n);
                        }}
                        onAnswer={(accept) => void answerRequest(n, accept)}
                      />
                    )}
                    <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                      {n.kind === 'episode' && (
                        <RowAction label="Больше не уведомлять про этот тайтл" onClick={() => void mute(n)}>
                          <BellOffIcon className="h-3.5 w-3.5" />
                        </RowAction>
                      )}
                      <RowAction label="Убрать уведомление" onClick={() => void dismiss(n)}>
                        <XIcon className="h-3.5 w-3.5" />
                      </RowAction>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function UnreadDot({ read }: { read: boolean }) {
  if (read) return null;
  return (
    <span className="relative mt-1 h-2 w-2 shrink-0 rounded-full bg-accent">
      <span className="sr-only">Не прочитано</span>
    </span>
  );
}

function EpisodeRow({ n, onOpen }: { n: EpisodeNotification; onOpen: () => void }) {
  return (
    <Link
      href={`/${n.content_type === 'cinema' ? 'cinema' : 'anime'}/${n.shikimori_id}`}
      onClick={onOpen}
      className={['flex gap-3 px-4 py-3 pr-16 transition hover:bg-white/5', n.read_at ? 'opacity-60' : ''].join(' ')}
    >
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
        {n.poster_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.poster_url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-gray-100">{n.title}</p>
        <p className="text-xs text-gray-400">Новая серия — теперь их {n.episode}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{timeAgo(n.created_at)}</p>
      </div>
      <UnreadDot read={!!n.read_at} />
    </Link>
  );
}

function SystemRow({ n, onOpen }: { n: SystemNotification; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={['flex w-full gap-3 px-4 py-3 pr-10 text-left transition hover:bg-white/5', n.read_at ? 'opacity-60' : ''].join(' ')}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-300">
        <AlertIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-gray-100">{n.title}</p>
        <p className="text-xs text-gray-400">{n.message}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{timeAgo(n.created_at)}</p>
      </div>
      <UnreadDot read={!!n.read_at} />
    </button>
  );
}

function SocialRow({
  n,
  onOpen,
  onAnswer,
}: {
  n: SocialNotification;
  onOpen: () => void;
  onAnswer: (accept: boolean) => void;
}) {
  const actor = n.actor ?? { id: '', name: 'Кто-то', avatarUrl: null };
  const where =
    n.type === 'comment_reply' && n.shikimori_id != null && n.episode != null && n.comment_id
      ? commentHref({
          contentType: n.content_type ?? 'anime',
          shikimoriId: n.shikimori_id,
          season: n.season ?? 1,
          episode: n.episode,
          id: n.comment_id,
        })
      : actor.id
        ? `/u/${actor.id}`
        : '/profile?tab=friends';

  const Icon = n.type === 'comment_reply' ? ReplyIcon : n.type === 'friend_request' ? UserPlusIcon : UserCheckIcon;
  const headline =
    n.type === 'comment_reply'
      ? 'ответ на ваш комментарий'
      : n.type === 'friend_request'
        ? 'хочет добавить вас в друзья'
        : 'теперь у вас в друзьях';

  return (
    <div className={['flex gap-3 px-4 py-3 pr-10 transition hover:bg-white/5', n.read_at ? 'opacity-70' : ''].join(' ')}>
      <div className="relative shrink-0">
        <Avatar user={actor} size="md" />
        <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-bg-card text-accent-text ring-2 ring-bg-card">
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <Link href={where} onClick={onOpen} className="block rounded-md focus-visible:outline-offset-4">
          <p className="text-sm text-gray-100">
            <span className="font-semibold">{actor.name}</span> <span className="text-gray-300">{headline}</span>
          </p>
          {n.type === 'comment_reply' && (
            <>
              {n.title && (
                <p className="line-clamp-1 text-xs text-gray-400">
                  {n.title}
                  {n.episode != null ? ` · серия ${n.episode}` : ''}
                </p>
              )}
              {n.snippet && <p className="mt-0.5 line-clamp-2 text-sm text-gray-200">{n.snippet}</p>}
            </>
          )}
          <p className="mt-0.5 text-[11px] text-gray-400">{timeAgo(n.created_at)}</p>
        </Link>
        {n.type === 'friend_request' && n.actor && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="press rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
            >
              Принять
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="press rounded-full px-3 py-1.5 text-xs font-medium text-gray-300 ring-1 ring-white/10 transition hover:bg-white/5"
            >
              Отклонить
            </button>
          </div>
        )}
      </div>
      <UnreadDot read={!!n.read_at} />
    </div>
  );
}

/**
 * Кнопка действия ПОВЕРХ строки, а не внутри неё: строка уведомления — это
 * ссылка, и вложенная кнопка внутри ссылки — невалидная разметка.
 * На мыши появляется по наведению, на тач-экранах видна всегда.
 */
function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press grid h-7 w-7 place-items-center rounded-full bg-bg-card/80 text-gray-400 opacity-100 transition hover:bg-white/10 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    >
      {children}
    </button>
  );
}
