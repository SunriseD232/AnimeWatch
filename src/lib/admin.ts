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

/**
 * Число зарегистрированных пользователей (auth.users) — для бейджа в шапке
 * у админов, см. Navbar.tsx. Список пользователей доступен только через
 * admin API (service_role, обходит RLS) — обычным клиентом не достать.
 * Кэшируем на 5 минут через общий межпроцессный кэш (api_response_cache) —
 * иначе это отдельный запрос к Supabase Auth на КАЖДЫЙ рендер шапки.
 */
export async function getUserCount(): Promise<number> {
  return getCachedJson('admin:user_count', 300, async () => {
    const service = createServiceClient();
    // perPage=1000 — с большим запасом относительно реальной аудитории
    // этого закрытого self-hosted сайта (доступ только по коду
    // регистрации); при таком масштабе пагинация не нужна.
    const { data, error } = await service.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error || !data) return 0;
    return data.users.length;
  });
}

/**
 * Сколько пользователей «сейчас онлайн» — по heartbeat (см. миграцию
 * 0021_user_presence.sql, PresenceHeartbeat.tsx шлёт отметку раз в ~45с,
 * пока вкладка видима). «Онлайн» — last_seen_at не старше 2 минут (heartbeat
 * раз в 45с даёт 2 пропуска на сетевые заминки, не показывает уже ушедших
 * подолгу). Без кэша — это дешёвый индексированный count по своей таблице,
 * не внешний API, и бейдж должен быть живым, а не отставать на 5 минут, как
 * getUserCount() выше.
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
