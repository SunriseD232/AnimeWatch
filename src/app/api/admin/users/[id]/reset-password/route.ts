import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/admin/users/[id]/reset-password — админ выставляет новый пароль
 * пользователю напрямую (email-восстановление недоступно, см.
 * ChangePasswordCard). Только service_role может менять чужой пароль
 * (supabase.auth.admin.updateUserById) — отсюда отдельный серверный роут,
 * а не прямой клиентский вызов, как в ChangePasswordCard (там своя сессия).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const password = String(body.password ?? '');
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Пароль должен быть не короче 6 символов' },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(params.id, { password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
