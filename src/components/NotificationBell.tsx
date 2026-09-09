'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppNotification } from '@/lib/types';

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

/** В какой таблице живёт уведомление этого вида — для markRead/markAllRead. */
function tableFor(kind: AppNotification['kind']): 'episode_notifications' | 'system_notifications' {
  return kind === 'episode' ? 'episode_notifications' : 'system_notifications';
}

/**
 * Колокольчик уведомлений: новые серии (тайтлы в статусе «Смотрю») +
 * системные уведомления для админов (например, истечение пробного периода
 * Vibix — см. lib/vibixTrial.ts). Начальный список приходит с сервера
 * (Navbar), дальше — Realtime-подписка на INSERT в обеих таблицах, чтобы
 * новые уведомления прилетали без перезагрузки страницы.
 */
export default function NotificationBell({
  initial,
}: {
  initial: AppNotification[];
}) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);

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

  const unread = items.filter((n) => !n.read_at).length;

  // Закрытие дропдауна по клику вовне и по Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notif-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'episode_notifications' },
        (payload) => {
          setItems((prev) => [
            { ...(payload.new as Omit<AppNotification, 'kind'>), kind: 'episode' } as AppNotification,
            ...prev,
          ]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'system_notifications' },
        (payload) => {
          setItems((prev) => [
            { ...(payload.new as Omit<AppNotification, 'kind'>), kind: 'system' } as AppNotification,
            ...prev,
          ]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function markRead(notification: AppNotification) {
    if (notification.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read_at: now } : n)),
    );
    const supabase = createClient();
    await supabase
      .from(tableFor(notification.kind))
      .update({ read_at: now })
      .eq('id', notification.id);
  }

  /**
   * Убрать одно уведомление. Оптимистично: строка исчезает сразу, запрос
   * уходит следом — ждать ответа ради удаления мелочи из списка незачем.
   * Не удалилось (нет сети) — вернётся при следующей загрузке страницы, это
   * честнее, чем блокировать интерфейс на время запроса.
   */
  async function dismiss(notification: AppNotification) {
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    const supabase = createClient();
    const { error } = await supabase
      .from(tableFor(notification.kind))
      .delete()
      .eq('id', notification.id);
    if (error) console.error('[NotificationBell] не удалилось:', error.message);
  }

  async function markAllRead() {
    const unreadItems = items.filter((n) => !n.read_at);
    if (unreadItems.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));

    const supabase = createClient();
    const episodeIds = unreadItems.filter((n) => n.kind === 'episode').map((n) => n.id);
    const systemIds = unreadItems.filter((n) => n.kind === 'system').map((n) => n.id);
    await Promise.all([
      episodeIds.length > 0
        ? supabase.from('episode_notifications').update({ read_at: now }).in('id', episodeIds)
        : Promise.resolve(),
      systemIds.length > 0
        ? supabase.from('system_notifications').update({ read_at: now }).in('id', systemIds)
        : Promise.resolve(),
    ]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          // Замер ДО показа, а не в эффекте после. Не спозиционированный
          // fixed-блок шириной 320px, отрисованный на первом кадре, вылезал
          // за правый край, страница получала горизонтальную прокрутку — и
          // замер возвращал координаты, сдвинутые на её величину. Список
          // улетал за левый край экрана.
          if (!open) measure();
          setOpen((v) => !v);
        }}
        aria-label="Уведомления"
        aria-haspopup="menu"
        aria-expanded={open}
        // На телефоне колокольчик ростом с поисковую строку (она py-2 при
        // text-base, то есть 42px): рядом с ней кнопка в 36px выглядела
        // приплюснутой и была мельче зоны уверенного попадания пальцем.
        // На широких экранах шапка плотнее, и там прежние 36px уместнее.
        className="press relative grid h-[42px] w-[42px] place-items-center rounded-full text-gray-300 hover:bg-white/5 hover:text-white md:h-9 md:w-9"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 md:h-5 md:w-5">
          <path
            d="M12 3a5 5 0 0 0-5 5v3.2c0 .5-.16 1-.46 1.4L5 15h14l-1.54-2.4c-.3-.4-.46-.9-.46-1.4V8a5 5 0 0 0-5-5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 18a2.5 2.5 0 0 0 5 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && box && (
        <div
          // fixed, а не absolute: позиция считается от шапки, чтобы список
          // начинался строго под ней. Ширина ограничена окном — на телефоне
          // колокольчик стоит не у самого края, и список шириной 90vw уезжал
          // левым краем за границу экрана.
          style={{ top: box.top, right: box.right }}
          className="glass-panel fixed z-50 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-semibold">Уведомления</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-accent hover:text-accent-hover"
              >
                Прочитать всё
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">
                Пока нет уведомлений
              </p>
            ) : (
              items.map((n) =>
                n.kind === 'system' ? (
                  <div key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => markRead(n)}
                    className={[
                      'flex w-full gap-3 border-b border-white/5 px-4 py-3 text-left transition last:border-b-0 hover:bg-white/5',
                      n.read_at ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-lg">
                      ⚠️
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-medium text-gray-100">
                        {n.title}
                      </p>
                      <p className="text-xs text-gray-400">{n.message}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.read_at && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </button>
                  <DismissButton onClick={() => dismiss(n)} />
                  </div>
                ) : (
                  <div key={n.id} className="group relative">
                  <Link
                    href={`/${n.content_type === 'cinema' ? 'cinema' : 'anime'}/${n.shikimori_id}`}
                    onClick={() => {
                      setOpen(false);
                      markRead(n);
                    }}
                    className={[
                      'flex gap-3 border-b border-white/5 px-4 py-3 transition last:border-b-0 hover:bg-white/5',
                      n.read_at ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                      {n.poster_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={n.poster_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-medium text-gray-100">
                        {n.title}
                      </p>
                      <p className="text-xs text-gray-400">
                        Новая серия — теперь их {n.episode}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.read_at && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </Link>
                  <DismissButton onClick={() => dismiss(n)} />
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Крестик «убрать это уведомление».
 *
 * Отдельным элементом ПОВЕРХ строки, а не внутри неё: строка уведомления —
 * это ссылка (или кнопка «прочитано»), и вложенная кнопка внутри ссылки —
 * невалидная разметка, по которой браузеры расходятся в поведении клика.
 *
 * На мыши появляется по наведению, на тач-экранах виден всегда: hover там
 * не существует, и спрятанный за ним крестик был бы недоступен вовсе.
 *
 * Снизу справа, а не сверху: сверху справа стоит точка «не прочитано», и
 * крестик её перекрывал бы. Внизу справа пусто — время публикации слева.
 */
function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Убрать уведомление"
      title="Убрать"
      className="press absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-bg-card/80 text-gray-400 opacity-100 transition hover:bg-white/10 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-2">
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeLinecap="round" />
      </svg>
    </button>
  );
}
