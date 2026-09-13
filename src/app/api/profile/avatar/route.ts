import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkRateLimit } from '@/lib/rateLimit';
import { AvatarError, removeAvatarFile, renderAvatar, storeAvatar } from '@/lib/social/avatar';
import { toPublicUser } from '@/lib/social/server';
import { AVATAR_MAX_BYTES } from '@/lib/social/types';

/**
 * POST /api/profile/avatar — загрузить аватар (multipart, поле file).
 * DELETE /api/profile/avatar — убрать.
 *
 * Лимит 5 МБ проверяется дважды: по Content-Length ДО чтения тела (иначе
 * сервер сначала честно примет хоть сотню мегабайт, а откажет потом) и по
 * размеру самого файла — заголовок клиент может и не прислать.
 */

// Запас на обвязку multipart вокруг файла: границы и заголовки части.
const MULTIPART_OVERHEAD = 64 * 1024;

async function verifiedUser() {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user;
}

export async function POST(request: NextRequest) {
  const user = await verifiedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы сменить аватар.' }, { status: 401 });

  const limit = checkRateLimit(`avatar:${user.id}`, 10, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Слишком много загрузок подряд. Попробуйте через несколько минут.' },
      { status: 429 },
    );
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES + MULTIPART_OVERHEAD) {
    return NextResponse.json({ error: 'Файл больше 5 МБ. Выберите изображение поменьше.' }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Файл не пришёл. Выберите изображение ещё раз.' }, { status: 400 });
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: 'Файл больше 5 МБ. Выберите изображение поменьше.' }, { status: 413 });
  }
  if (file.type && !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Это не изображение. Подойдёт JPEG, PNG, WebP или GIF.' }, { status: 415 });
  }

  let rendered: Buffer;
  try {
    rendered = await renderAvatar(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    const message = err instanceof AvatarError ? err.message : 'Не удалось обработать изображение.';
    return NextResponse.json({ error: message }, { status: 415 });
  }

  const service = createServiceClient();
  const { data: previous } = await service
    .from('profiles')
    .select('avatar_path')
    .eq('user_id', user.id)
    .maybeSingle();

  const avatarPath = await storeAvatar(rendered);
  const { data, error } = await service
    .from('profiles')
    .upsert(
      { user_id: user.id, avatar_path: avatarPath, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select('user_id, display_name, avatar_path')
    .single();

  if (error) {
    await removeAvatarFile(avatarPath);
    console.error(`[avatar] user=${user.id} save failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось сохранить аватар. Попробуйте ещё раз.' }, { status: 500 });
  }

  await removeAvatarFile(previous?.avatar_path);
  console.log(`[avatar] user=${user.id} ${file.size}B -> ${rendered.length}B`);
  return NextResponse.json({ user: toPublicUser(user.id, data) });
}

export async function DELETE() {
  const user = await verifiedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы изменить профиль.' }, { status: 401 });

  const service = createServiceClient();
  const { data: previous } = await service
    .from('profiles')
    .select('avatar_path')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data, error } = await service
    .from('profiles')
    .upsert(
      { user_id: user.id, avatar_path: null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select('user_id, display_name, avatar_path')
    .single();
  if (error) {
    console.error(`[avatar] user=${user.id} remove failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось убрать аватар. Попробуйте ещё раз.' }, { status: 500 });
  }

  await removeAvatarFile(previous?.avatar_path);
  return NextResponse.json({ user: toPublicUser(user.id, data) });
}
