'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { logEvent } from '@/lib/clientLog';
import { nameOf } from '@/lib/social/names';
import { useToast } from '@/components/ToastProvider';
import type { ContentType } from '@/lib/types';
import {
  PARTY_CHAT_MAX_LENGTH,
  type PartyChatMessage,
  type PartyInfo,
  type PartyLocalContext,
  type PartyMember,
  type PartyPlaybackState,
  type PartyPlayerControl,
  type PartyStateKind,
  type PartyUserAction,
} from '@/lib/party/types';
import { decideSync } from '@/lib/party/sync';

/**
 * Совместный просмотр («Смотреть вместе»).
 *
 * Живёт в корневом layout рядом с PipPlayerHost и не размонтируется при
 * переходах — уход на другую страницу не должен выкидывать из комнаты.
 *
 * Транспорт — приватный канал Supabase Realtime `party:<id>` (пускает только
 * участников, см. политики на realtime.messages в миграции 0048):
 *   - broadcast `state` — снимок хода просмотра (PartyPlaybackState);
 *   - broadcast `hello` — «я только вошёл, скажите, где вы»;
 *   - broadcast `chat` — сообщение чата (история не хранится нигде);
 *   - presence — кто сейчас в комнате.
 *
 * Управляют все (решение владельца сайта): побеждает последнее по времени
 * действие. Время — серверное (см. /api/party/time), иначе расхождение часов
 * устройств путало бы и порядок действий, и расчёт позиции.
 *
 * Связь с плеером — PartyPlayerControl, который OwnPlayer кладёт в
 * playerControlRef. Связь со страницей просмотра — reportContext (что у меня
 * открыто) и remoteTarget (на какую серию/озвучку переключиться за
 * остальными).
 */

interface CreatePartyArgs {
  contentType: ContentType;
  shikimoriId: number;
  title: string;
  season: number;
  episode: number;
}

/** Куда страница просмотра должна переключиться вслед за комнатой. */
export interface PartyRemoteTarget {
  season: number;
  episode: number;
  translationId: number | null;
  /** Растёт на каждое новое указание — страница реагирует на смену key. */
  key: number;
}

interface WatchPartyContextValue {
  party: PartyInfo | null;
  inviteUrl: string | null;
  creating: boolean;
  create: (args: CreatePartyArgs) => Promise<void>;
  leave: () => Promise<void>;
  isPartyTitle: (contentType: ContentType, shikimoriId: number) => boolean;
  playerControlRef: MutableRefObject<PartyPlayerControl | null>;
  reportUserAction: (action: PartyUserAction) => void;
  reportContext: (ctx: PartyLocalContext | null) => void;
  remoteTarget: PartyRemoteTarget | null;
}

interface WatchPartyRoomValue {
  members: PartyMember[];
  messages: PartyChatMessage[];
  me: PartyMember | null;
  connected: boolean;
  sendChat: (text: string) => void;
}

const WatchPartyContext = createContext<WatchPartyContextValue | null>(null);
// Участники и чат — отдельным контекстом: они меняются часто, а на основной
// подписана страница просмотра целиком (Player.tsx), и каждое сообщение чата
// перерисовывало бы её вместе с плеером.
const WatchPartyRoomContext = createContext<WatchPartyRoomValue | null>(null);

export function useWatchParty(): WatchPartyContextValue {
  const ctx = useContext(WatchPartyContext);
  if (!ctx) throw new Error('useWatchParty вызван вне WatchPartyProvider');
  return ctx;
}

export function useWatchPartyRoom(): WatchPartyRoomValue {
  const ctx = useContext(WatchPartyRoomContext);
  if (!ctx) throw new Error('useWatchPartyRoom вызван вне WatchPartyProvider');
  return ctx;
}

const STORAGE_KEY = 'mw:watch-party';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Как часто сверяться с комнатой, пока видео играет. */
const SYNC_INTERVAL_MS = 1_500;
const CHAT_KEEP = 100;
/** Срок жизни комнаты — как в join_watch_party (миграция 0048). */
const PARTY_TTL_MS = 24 * 60 * 60 * 1000;
/** Озвучка, сменившаяся вскоре после смены серии, — подбор плеером под новую
 *  серию (у аниме id озвучек свои на каждую серию), а не выбор человека. */
const TRANSLATION_SETTLE_MS = 8_000;

const ACTION_LABELS: Partial<Record<PartyStateKind, string>> = {
  play: 'продолжает',
  pause: 'ставит на паузу',
  seek: 'перематывает',
  rate: 'меняет скорость',
  episode: 'переключает серию',
  translation: 'меняет озвучку',
};

function sameTitle(a: PartyLocalContext | null, info: PartyInfo | null): boolean {
  return !!a && !!info && a.contentType === info.contentType && a.shikimoriId === info.shikimoriId;
}

export function WatchPartyProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const pathname = usePathname();
  // Клиент — только в браузере и по первому обращению: layout рендерится и на
  // сервере (в том числе при пререндере статических страниц), а браузерному
  // клиенту там делать нечего.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const [party, setParty] = useState<PartyInfo | null>(null);
  const [me, setMe] = useState<PartyMember | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [messages, setMessages] = useState<PartyChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remoteTarget, setRemoteTarget] = useState<PartyRemoteTarget | null>(null);

  const partyRef = useRef<PartyInfo | null>(null);
  partyRef.current = party;
  const meRef = useRef<PartyMember | null>(null);
  meRef.current = me;
  const membersRef = useRef<PartyMember[]>([]);
  membersRef.current = members;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const playerControlRef = useRef<PartyPlayerControl | null>(null);
  const localCtxRef = useRef<PartyLocalContext | null>(null);
  /** Самое свежее известное состояние комнаты — своё или чужое. */
  const lastStateRef = useRef<PartyPlaybackState | null>(null);
  /** Смещение: часы сервера = Date.now() + clockOffsetRef. */
  const clockOffsetRef = useRef(0);
  const lastSeekIssuedAtRef = useRef(0);
  const targetKeyRef = useRef(0);
  const episodeChangedAtRef = useRef(0);

  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);

  // --- Кто я -----------------------------------------------------------------
  // И при загрузке, и при смене сессии: вход и выход на сайте идут без
  // перезагрузки страницы, а layout с этим провайдером живёт всё время.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await getSupabase().auth.getUser();
      const user = data.user;
      if (cancelled) return;
      if (!user) {
        setMe(null);
        return;
      }
      const { data: row } = await getSupabase()
        .from('profiles')
        .select('display_name, avatar_path')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setMe((prev) =>
        prev && prev.userId === user.id && prev.name === nameOf(row?.display_name, user.id) && prev.avatarUrl === (row?.avatar_path ?? null)
          ? prev
          : { userId: user.id, name: nameOf(row?.display_name, user.id), avatarUrl: row?.avatar_path ?? null },
      );
    };
    void load();
    const { data: sub } = getSupabase().auth.onAuthStateChange((event) => {
      // Обновление токена — тот же человек, перечитывать незачем.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void load();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [getSupabase]);

  // --- Какая комната активна -------------------------------------------------
  // ?party=<id> приходит со страницы-приглашения (/party/[id]) или после
  // создания; дальше id живёт в sessionStorage этой вкладки, чтобы переходы и
  // обновление страницы не выкидывали из комнаты. Параметр убираем из адреса —
  // иначе он ехал бы дальше в «Поделиться» и закладки.
  const activate = useCallback(
    async (id: string) => {
      if (partyRef.current?.id === id) return;
      const { data } = await getSupabase()
        .from('watch_parties')
        .select('id, content_type, shikimori_id, title, created_at')
        .eq('id', id)
        .maybeSingle();
      // Сутки — тот же срок, что у входа по ссылке (join_watch_party): иначе
      // вкладка, помнящая вчерашнюю комнату, открывала бы её снова.
      const expired = !!data && Date.now() - new Date(data.created_at).getTime() > PARTY_TTL_MS;
      if (!data || expired) {
        // Не участник (вышел на другом устройстве), комнату закрыли или она
        // отжила свои сутки.
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* приватный режим */
        }
        return;
      }
      lastStateRef.current = null;
      setMessages([]);
      setRemoteTarget(null);
      setParty({
        id: data.id,
        contentType: data.content_type as ContentType,
        shikimoriId: Number(data.shikimori_id),
        title: data.title,
      });
      try {
        window.sessionStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* приватный режим */
      }
    },
    [getSupabase],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('party');
    if (fromUrl && UUID_RE.test(fromUrl)) {
      url.searchParams.delete('party');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      void activate(fromUrl);
      return;
    }
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
      /* приватный режим */
    }
    if (stored && UUID_RE.test(stored)) void activate(stored);
  }, [pathname, activate]);

  // --- Часы сервера ------------------------------------------------------------
  // Три замера, берём с самым коротким ответом: у него меньше всего
  // неопределённость, на какую половину пути пришлось чтение часов.
  useEffect(() => {
    if (!party) return;
    let cancelled = false;
    (async () => {
      let best: { rtt: number; offset: number } | null = null;
      for (let i = 0; i < 3 && !cancelled; i++) {
        try {
          const t0 = Date.now();
          const res = await fetch('/api/party/time', { cache: 'no-store' });
          const { now } = (await res.json()) as { now: number };
          const t1 = Date.now();
          const rtt = t1 - t0;
          if (!best || rtt < best.rtt) best = { rtt, offset: now - (t0 + t1) / 2 };
        } catch {
          /* сеть моргнула — обойдёмся остальными замерами */
        }
      }
      if (!cancelled && best) clockOffsetRef.current = best.offset;
    })();
    return () => {
      cancelled = true;
    };
  }, [party]);

  // --- Куда переключиться за комнатой ----------------------------------------
  // Серия или озвучка комнаты отличается от открытой у меня — просим страницу
  // переключиться (см. remoteTarget в Player.tsx/WatchPlayer.tsx).
  const pointPageAtState = useCallback((state: PartyPlaybackState) => {
    const ctx = localCtxRef.current;
    if (!ctx || !sameTitle(ctx, partyRef.current)) return;
    if (
      ctx.season === state.season &&
      ctx.episode === state.episode &&
      (state.translationId == null || ctx.translationId === state.translationId)
    ) {
      return;
    }
    targetKeyRef.current += 1;
    setRemoteTarget({
      season: state.season,
      episode: state.episode,
      translationId: state.translationId,
      key: targetKeyRef.current,
    });
  }, []);

  // --- Применение состояния комнаты к своему плееру ---------------------------
  const applyPlayback = useCallback(() => {
    const st = lastStateRef.current;
    const ctrl = playerControlRef.current;
    const ctx = localCtxRef.current;
    if (!st || !ctrl || !ctx || !sameTitle(ctx, partyRef.current)) return;
    // Страница ещё переключается на нужную серию — сверять позицию рано.
    if (ctx.season !== st.season || ctx.episode !== st.episode) return;
    const snap = ctrl.snapshot();
    if (!snap) return;
    const d = decideSync(st, snap, serverNow(), Date.now() - lastSeekIssuedAtRef.current);
    if (d.rate != null) ctrl.setRate(d.rate);
    if (d.seekTo != null) {
      lastSeekIssuedAtRef.current = Date.now();
      ctrl.seek(d.seekTo);
    }
    if (d.play) ctrl.play();
    if (d.pause) ctrl.pause();
  }, [serverNow]);

  useEffect(() => {
    if (!party) return;
    const id = setInterval(applyPlayback, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [party, applyPlayback]);

  // --- Рассылка своего состояния ----------------------------------------------
  const publish = useCallback(
    (kind: PartyStateKind, override?: Partial<PartyPlaybackState>) => {
      const channel = channelRef.current;
      const ctx = localCtxRef.current;
      const self = meRef.current;
      if (!channel || !ctx || !self || !sameTitle(ctx, partyRef.current)) return;
      const snap = playerControlRef.current?.snapshot() ?? null;
      const state: PartyPlaybackState = {
        season: ctx.season,
        episode: ctx.episode,
        translationId: ctx.translationId,
        playing: snap?.playing ?? false,
        time: snap?.time ?? 0,
        rate: snap?.rate ?? 1,
        at: serverNow(),
        by: self.userId,
        kind,
        ...override,
      };
      lastStateRef.current = state;
      void channel.send({ type: 'broadcast', event: 'state', payload: state });
    },
    [serverNow],
  );

  const reportUserAction = useCallback(
    (action: PartyUserAction) => {
      // Только что сделанная перемотка — своя, не наша коррекция: не даём
      // таймеру сверки тут же «поправить» её назад по старому состоянию.
      if (action === 'seek') lastSeekIssuedAtRef.current = 0;
      publish(action);
    },
    [publish],
  );

  const reportContext = useCallback(
    (ctx: PartyLocalContext | null) => {
      const prev = localCtxRef.current;
      localCtxRef.current = ctx;
      if (!ctx || !sameTitle(ctx, partyRef.current)) return;
      if (!prev || !sameTitle(prev, partyRef.current)) {
        // Страница только открылась (или вернулась на «Наш плеер»), а комната
        // уже сказала, где она, — идём туда. Ответ на hello мог прийти раньше,
        // чем страница успела отчитаться.
        const known = lastStateRef.current;
        if (known && known.by !== meRef.current?.userId) pointPageAtState(known);
        return;
      }
      const st = lastStateRef.current;
      const episodeChanged = prev.season !== ctx.season || prev.episode !== ctx.episode;
      if (episodeChanged) episodeChangedAtRef.current = Date.now();
      // Озвучка «появляется» у плеера после загрузки списка (null → id) —
      // это не выбор человека. Сменой считаем только переход между двумя
      // известными озвучками.
      const translationChanged =
        prev.translationId != null &&
        ctx.translationId != null &&
        prev.translationId !== ctx.translationId &&
        Date.now() - episodeChangedAtRef.current > TRANSLATION_SETTLE_MS;
      if (!episodeChanged && !translationChanged) return;
      // Страница пришла туда, куда её позвала комната, — это не новое
      // действие, рассылать нечего.
      const followsRoom =
        !!st &&
        st.season === ctx.season &&
        st.episode === ctx.episode &&
        (!translationChanged || st.translationId === ctx.translationId);
      if (followsRoom) return;
      if (episodeChanged) publish('episode', { time: 0, playing: true });
      else publish('translation');
    },
    [publish, pointPageAtState],
  );

  // --- Канал комнаты -----------------------------------------------------------
  useEffect(() => {
    if (!party || !me) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const onState = (state: PartyPlaybackState) => {
      const current = lastStateRef.current;
      if (current && state.at < current.at) return; // устарело: уже есть более позднее действие
      lastStateRef.current = state;
      pointPageAtState(state);
      // Чужое действие — свежая точка отсчёта, сверяемся сразу, без кулдауна.
      lastSeekIssuedAtRef.current = 0;
      applyPlayback();
      const label = ACTION_LABELS[state.kind];
      if (label) {
        const who = membersRef.current.find((m) => m.userId === state.by)?.name ?? 'Участник';
        toast(`${who} ${label}`);
      }
    };

    (async () => {
      // Приватному каналу нужен токен пользователя ДО подписки — supabase-js
      // выставляет его по событию сессии, но к первой подписке оно могло ещё
      // не прийти.
      const { data } = await getSupabase().auth.getSession();
      if (cancelled) return;
      await getSupabase().realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = getSupabase().channel(`party:${party.id}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: me.userId } },
      });
      channelRef.current = channel;
      channel
        .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload as PartyPlaybackState))
        .on('broadcast', { event: 'hello' }, () => {
          // Новичок спрашивает, где мы. Отвечает тот, у кого открыт плеер
          // этой комнаты; ответов может быть несколько — новичок возьмёт
          // самый поздний.
          if (playerControlRef.current?.snapshot()) publish('sync');
        })
        .on('broadcast', { event: 'chat' }, ({ payload }) => {
          const msg = payload as PartyChatMessage;
          setMessages((prev) => [...prev, msg].slice(-CHAT_KEEP));
        })
        .on('presence', { event: 'sync' }, () => {
          const state = channel?.presenceState<PartyMember>() ?? {};
          const list = Object.values(state)
            .map((entries) => entries[0])
            .filter((m): m is PartyMember & { presence_ref: string } => !!m && typeof m.userId === 'string')
            .map(({ userId, name, avatarUrl }) => ({ userId, name, avatarUrl }));
          setMembers(list);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setConnected(true);
            void channel?.track({ userId: me.userId, name: me.name, avatarUrl: me.avatarUrl });
            void channel?.send({ type: 'broadcast', event: 'hello', payload: {} });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnected(false);
            if (status === 'CHANNEL_ERROR') {
              logEvent('party.channel_error', { partyId: party.id });
            }
          }
        });
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      setMembers([]);
      if (channelRef.current === channel) channelRef.current = null;
      if (channel) void getSupabase().removeChannel(channel);
    };
  }, [party, me, getSupabase, applyPlayback, publish, pointPageAtState, toast]);

  // --- Действия ----------------------------------------------------------------
  const create = useCallback(
    async (args: CreatePartyArgs) => {
      setCreating(true);
      try {
        const { data, error } = await getSupabase().rpc('create_watch_party', {
          p_content_type: args.contentType,
          p_shikimori_id: args.shikimoriId,
          p_title: args.title,
          p_season: args.season,
          p_episode: args.episode,
        });
        if (error || typeof data !== 'string') {
          toast('Не получилось создать комнату. Попробуйте ещё раз', 'error');
          return;
        }
        logEvent('party.create', { partyId: data, contentType: args.contentType, shikimoriId: args.shikimoriId });
        await activate(data);
      } finally {
        setCreating(false);
      }
    },
    [getSupabase, activate, toast],
  );

  const leave = useCallback(async () => {
    const current = partyRef.current;
    if (!current) return;
    setParty(null);
    setMessages([]);
    setRemoteTarget(null);
    lastStateRef.current = null;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* приватный режим */
    }
    await getSupabase().rpc('leave_watch_party', { p_party: current.id });
  }, [getSupabase]);

  const sendChat = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, PARTY_CHAT_MAX_LENGTH);
      const self = meRef.current;
      const channel = channelRef.current;
      if (!text || !self || !channel) return;
      const msg: PartyChatMessage = {
        id: `${self.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: self.userId,
        name: self.name,
        text,
        at: serverNow(),
      };
      // broadcast.self выключен — своё сообщение добавляем сами.
      setMessages((prev) => [...prev, msg].slice(-CHAT_KEEP));
      void channel.send({ type: 'broadcast', event: 'chat', payload: msg });
    },
    [serverNow],
  );

  const isPartyTitle = useCallback(
    (contentType: ContentType, shikimoriId: number) =>
      !!party && party.contentType === contentType && party.shikimoriId === shikimoriId,
    [party],
  );

  const inviteUrl = party ? `${typeof window === 'undefined' ? '' : window.location.origin}/party/${party.id}` : null;

  const value = useMemo<WatchPartyContextValue>(
    () => ({
      party,
      inviteUrl,
      creating,
      create,
      leave,
      isPartyTitle,
      playerControlRef,
      reportUserAction,
      reportContext,
      remoteTarget,
    }),
    [party, inviteUrl, creating, create, leave, isPartyTitle, reportUserAction, reportContext, remoteTarget],
  );

  const room = useMemo<WatchPartyRoomValue>(
    () => ({ members, messages, me, connected, sendChat }),
    [members, messages, me, connected, sendChat],
  );

  return (
    <WatchPartyContext.Provider value={value}>
      <WatchPartyRoomContext.Provider value={room}>{children}</WatchPartyRoomContext.Provider>
    </WatchPartyContext.Provider>
  );
}
