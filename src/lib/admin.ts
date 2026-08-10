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

export interface PresenceSummary {
  totalCount: number;
  totalEmails: string[];
  onlineCount: number;
  onlineEmails: string[];
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
    // регистрации); при таком масштабе пагинация не нужна.
    const [{ data: usersData, error: usersError }, { data: presenceRows }] =
      await Promise.all([
        service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        service.from('user_presence').select('user_id').gte('last_seen_at', threshold),
      ]);

    const users = !usersError && usersData ? usersData.users : [];
    const totalEmails = users
      .map((u) => u.email ?? u.id)
      .sort((a, b) => a.localeCompare(b));

    const onlineIds = new Set((presenceRows ?? []).map((r) => r.user_id as string));
    const onlineEmails = users
      .filter((u) => onlineIds.has(u.id))
      .map((u) => u.email ?? u.id)
      .sort((a, b) => a.localeCompare(b));

    return {
      totalCount: totalEmails.length,
      totalEmails,
      onlineCount: onlineEmails.length,
      onlineEmails,
    };
  });
}
