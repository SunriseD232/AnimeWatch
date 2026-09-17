import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizeDisplayName, validateDisplayName } from '@/lib/social/names';
import { normalizeVisibility } from '@/lib/social/types';
import { QUALITY_OPTIONS } from '@/lib/playerQuality';
import { toPublicUser } from '@/lib/social/server';

/**
 * PATCH /api/profile — отображаемое имя и настройки приватности. Любое поле
 * необязательно: что не пришло, то не трогаем (upsert обновляет только
 * переданные колонки).
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
  const patch: Record<string, string | number | boolean | null> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (typeof body?.displayName === 'string') {
    const displayName = normalizeDisplayName(body.displayName);
    // Пустое — «убрать имя»: вернуться к нейтральной подписи тоже законно.
    if (displayName.length > 0) {
      const problem = validateDisplayName(displayName);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }
    patch.display_name = displayName.length > 0 ? displayName : null;
  }
  if (body?.listsVisibility !== undefined) {
    patch.lists_visibility = normalizeVisibility(body.listsVisibility);
  }
  if (body?.ratingsVisibility !== undefined) {
    patch.ratings_visibility = normalizeVisibility(body.ratingsVisibility);
  }
  if (body?.preferredQuality !== undefined) {
    // Мусор молча не пишем: в колонке стоит CHECK (см. миграцию 0038), и
    // запрос всё равно упал бы 500-й, хотя это обычная ошибка ввода.
    const quality = Number(body.preferredQuality);
    if (!(QUALITY_OPTIONS as readonly number[]).includes(quality)) {
      return NextResponse.json({ error: 'Такого качества нет.' }, { status: 400 });
    }
    patch.preferred_quality = quality;
  }
  if (body?.syncPlayerQuality !== undefined) {
    patch.sync_player_quality = !!body.syncPlayerQuality;
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .upsert(patch, { onConflict: 'user_id' })
    .select('user_id, display_name, avatar_path, lists_visibility, ratings_visibility, preferred_quality, sync_player_quality')
    .single();

  if (error) {
    // 23505 — уникальный индекс по lower(display_name).
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Это имя уже занято. Попробуйте другое.' }, { status: 409 });
    }
    console.error(`[profile] user=${user.id} update failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось сохранить. Попробуйте ещё раз.' }, { status: 500 });
  }

  return NextResponse.json({
    user: toPublicUser(user.id, data),
    privacy: {
      lists: normalizeVisibility(data.lists_visibility),
      ratings: normalizeVisibility(data.ratings_visibility),
    },
    player: {
      quality: data.preferred_quality ?? null,
      sync: !!data.sync_player_quality,
    },
  });
}
