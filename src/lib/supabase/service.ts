import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Клиент Supabase с service_role — обходит RLS. ТОЛЬКО для серверных задач
 * без пользовательской сессии (крон check-episodes), которым нужен доступ ко
 * ВСЕМ строкам таблицы (например, user_list всех пользователей, а не только
 * текущего). Ключ приватный — модуль не должен попасть в клиентский бандл
 * (используется исключительно в Route Handlers).
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
