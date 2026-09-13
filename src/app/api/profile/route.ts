import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizeDisplayName, validateDisplayName } from '@/lib/social/names';
import { toPublicUser } from '@/lib/social/server';

/**
 * PATCH /api/profile — отображаемое имя.
 *
 * Пишет service_role, а не клиент с сессией: у таблицы profiles нет ни одной
 * политики на запись для authenticated (см. миграцию 0036 — иначе клиент
 * мог бы записать себе в avatar_path чужой адрес). Поэтому личность здесь
 * проверяется через getUser() — сетевой проход к Auth, а не чтение куки:
 * запись в обход RLS не должна верить непроверенному токену.
 */
export async function PATCH(request: NextRequest) {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы изменить профиль.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const raw = typeof body?.displayName === 'string' ? body.displayName : '';
  const displayName = normalizeDisplayName(raw);

  // Пустое — «убрать имя»: вернуться к нейтральной подписи тоже законно.
  if (displayName.length > 0) {
    const problem = validateDisplayName(displayName);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .upsert(
      {
        user_id: user.id,
        display_name: displayName.length > 0 ? displayName : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, display_name, avatar_path')
    .single();

  if (error) {
    // 23505 — уникальный индекс по lower(display_name).
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Это имя уже занято. Попробуйте другое.' }, { status: 409 });
    }
    console.error(`[profile] user=${user.id} name update failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось сохранить имя. Попробуйте ещё раз.' }, { status: 500 });
  }

  return NextResponse.json({ user: toPublicUser(user.id, data) });
}
