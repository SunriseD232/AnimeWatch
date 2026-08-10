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
 * Число зарегистрированных + «сейчас онлайн» пользователей (auth.users), с
 * почтами — для бейджа в шапке у админов (клик раскрывает список, см.
 * Navbar.tsx/UserPresenceBadge.tsx). Список пользователей и почты доступны
 * только через admin API (service_role, обходит RLS) — обычным клиентом не
 * достать. «Онлайн» — по heartbeat (см. миграцию 0021_user_presence.sql,
 * PresenceHeartbeat.tsx шлёт отметку раз в ~45с, пока вкладка видима);
 * last_seen_at не старше 2 минут — 2 пропуска heartbeat на сетевые заминки,
 * не показывает давно ушедших.
 *
 * Кэшируем на 30 секунд общим межпроцессным кэшем (api_response_cache) —
 * без этого каждый рендер шапки у админа бил бы по Auth admin API. 30с — TTL
 * пониже, чем было у отдельного getUserCount() (5 мин): "онлайн" должен
 * оставаться довольно свежим, а список пользователей всё равно приходится
 * тянуть заново вместе с online-частью в одном запросе.
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
