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
