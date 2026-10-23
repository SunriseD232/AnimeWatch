import { createClient } from '@/lib/supabase/server';
import type { ContentType, UserListStatus } from '@/lib/types';

/**
 * Статус тайтла в списке текущего человека — для кнопки «В список» на
 * карточках подкастов, книг, ранобэ и манги. RLS отдаёт только свои строки,
 * поэтому фильтра по user_id нет. Гость или сбой базы — null: кнопка
 * покажется пустой, страница не упадёт.
 */
export async function getListEntry(
  contentType: ContentType,
  id: number,
): Promise<{ status: UserListStatus; muted: boolean } | null> {
  try {
    const { data } = await createClient()
      .from('user_list')
      .select('status, muted')
      .eq('content_type', contentType)
      .eq('shikimori_id', id)
      .maybeSingle();
    return data ? { status: data.status as UserListStatus, muted: !!data.muted } : null;
  } catch {
    return null;
  }
}
