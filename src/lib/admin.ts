import { createServiceClient } from '@/lib/supabase/service';
import { getCachedJson } from '@/lib/cache/apiCache';

/**
 * Аккаунты с доступом к внутренним админ-разделам (код регистрации,
 * статус пробных периодов балансеров). Общий список — используется и в
 * /code, и в профиле, и в кроне, генерирующем системные уведомления.
 */
export const ADMIN_EMAILS = ['2000gva@gmail.com', 'timewolf567@gmail.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}

export interface AdminUserEntry {
  id: string;
  email: string;
  /** ISO-время последнего heartbeat (см. миграцию 0021_user_presence.sql) — null, если пользователь никогда не заходил (нет строки в user_presence). */
  lastSeenAt: string | null;
  online: boolean;
}

export interface PresenceSummary {
  totalCount: number;
  onlineCount: number;
  /** Онлайн — первыми, дальше по убыванию lastSeenAt (никогда не заходившие — в конце). */
  users: AdminUserEntry[];
}

/**
 * Только число «сейчас онлайн» — дешёвый индексированный count по своей
 * таблице (см. миграцию 0021_user_presence.sql), БЕЗ обращения к Auth admin
 * API. Это то, что показывается в шапке сразу у каждого админа на КАЖДОЙ
 * навигации (Navbar рендерится всегда, а у сайта отключён клиентский Router
 * Cache для динамики — staleTimes:0 в next.config.js — так что это реально
 * бьёт на каждый переход). Список почт (getPresenceSummary ниже) специально
 * НЕ вызывается тут — тянуть его на каждый рендер шапки заметно замедляло
 * весь сайт админу (admin.listUsers + доп. round-trip в api_response_cache
 * на КАЖДОМ переходе — поиск, открытие тайтла, возврат на главную), см.
 * коммит, который это исправил. Детали (почты) — по клику, лениво, через
 * /api/admin/presence, см. UserPresenceBadge.tsx.
 */
export async function getOnlineUserCount(): Promise<number> {
  const service = createServiceClient();
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { count } = await service
    .from('user_presence')
    .select('user_id', { count: 'exact', head: true })
    .gte('last_seen_at', threshold);
  return count ?? 0;
}

/**
 * Полная сводка (счётчики + почты) — тяжёлая (admin.listUsers), поэтому
 * вызывается ТОЛЬКО из /api/admin/presence, по клику на бейдж в шапке
 * (UserPresenceBadge.tsx), а не при каждом рендере Navbar — см.
 * getOnlineUserCount выше про то, почему это важно. Кэш 30с общим
 * межпроцессным кэшем (api_response_cache) на случай, если админ открывает
 * дропдаун повторно за короткое время.
 */
export async function getPresenceSummary(): Promise<PresenceSummary> {
  return getCachedJson('admin:presence_summary', 30, async () => {
    const service = createServiceClient();
    const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    // perPage=1000 — с большим запасом относительно реальной аудитории
    // этого закрытого self-hosted сайта (доступ только по коду
    // регистрации); при таком масштабе пагинация не нужна. last_seen_at —
    // без threshold-фильтра, нужен для КАЖДОГО пользователя (в т.ч. давно
    // не заходивших), не только для тех, кто онлайн прямо сейчас.
    const [{ data: usersData, error: usersError }, { data: presenceRows }] =
      await Promise.all([
        service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        service.from('user_presence').select('user_id, last_seen_at'),
      ]);

    const users = !usersError && usersData ? usersData.users : [];
    const lastSeenById = new Map(
      (presenceRows ?? []).map((r) => [r.user_id as string, r.last_seen_at as string]),
    );

    const entries: AdminUserEntry[] = users.map((u) => {
      const lastSeenAt = lastSeenById.get(u.id) ?? null;
      return {
        id: u.id,
        email: u.email ?? u.id,
        lastSeenAt,
        online: lastSeenAt !== null && lastSeenAt >= threshold,
      };
    });

    // Онлайн — первыми, дальше по убыванию lastSeenAt (ISO-строки
    // сравниваются лексикографически так же, как хронологически),
    // никогда не заходившие (lastSeenAt===null) — в самом конце.
    entries.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.lastSeenAt && b.lastSeenAt) return b.lastSeenAt.localeCompare(a.lastSeenAt);
      if (a.lastSeenAt) return -1;
      if (b.lastSeenAt) return 1;
      return a.email.localeCompare(b.email);
    });

    return {
      totalCount: entries.length,
      onlineCount: entries.filter((e) => e.online).length,
      users: entries,
    };
  });
}
