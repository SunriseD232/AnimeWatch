import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizeDisplayName, validateDisplayName } from '@/lib/social/names';
import { toPublicUser } from '@/lib/social/server';

/**
 * PATCH /api/admin/users/[id]/profile — админ меняет или снимает
 * отображаемое имя пользователя (модерация: имя нарушает правила и т.п.).
 *
 * Только service_role может писать в profiles (у таблицы нет политик на
 * запись для authenticated, см. миграцию 0036) — поэтому отдельный
 * серверный роут с проверкой роли через getUser(), как и в
 * reset-password. Пустое/отсутствующее имя = «снять имя», вернуться к
 * нейтральной подписи.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const displayName = normalizeDisplayName(String(body?.displayName ?? ''));
  if (displayName.length > 0) {
    const problem = validateDisplayName(displayName);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .upsert(
      {
        user_id: params.id,
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
      return NextResponse.json({ error: 'Это имя уже занято другим пользователем.' }, { status: 409 });
    }
    console.error(`[admin/profile] target=${params.id} update failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось сохранить. Попробуйте ещё раз.' }, { status: 500 });
  }

  return NextResponse.json({ user: toPublicUser(params.id, data) });
}
