'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { logEvent } from '@/lib/clientLog';
import type { ContentType, UserListStatus } from '@/lib/types';

/**
 * Общая логика «быстро добавить тайтл в список» — вынесена из
 * QuickListButton, чтобы карточка-плитка (QuickListButton) и строка
 * списочного вида каталога (AnimeListRow) не держали два независимых
 * копипаста upsert/delete. Оба места не знают начальный статус тайтла
 * (в каталоге его не тянем на каждую из карточек ради дешевизны запроса) —
 * начинают с null, значок «+» до первого действия в этой сессии.
 */
export function useQuickListStatus({
  shikimoriId,
  contentType,
  title,
  posterUrl,
  source,
}: {
  shikimoriId: number;
  contentType: ContentType;
  title: string;
  posterUrl: string | null;
  /** Метка источника для clientLog — откуда пришло изменение (карточка/строка). */
  source: string;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserListStatus | null>(null);
  const [saving, setSaving] = useState(false);

  async function choose(next: UserListStatus | null) {
    if (next === status) return;
    setSaving(true);
    const supabase = createClient();
    try {
      if (next === null) {
        const { error } = await supabase
          .from('user_list')
          .delete()
          .eq('content_type', contentType)
          .eq('shikimori_id', shikimoriId);
        if (error) throw error;
        setStatus(null);
        toast('Убрано из списка', 'success');
        logEvent('list.removed', { contentType, shikimoriId, source });
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Войдите, чтобы вести список');
      const { error } = await supabase.from('user_list').upsert(
        {
          user_id: user.id,
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: title,
          poster_url: posterUrl,
          status: next,
        },
        { onConflict: 'user_id,content_type,shikimori_id' },
      );
      if (error) throw error;
      const wasEmpty = status === null;
      setStatus(next);
      toast(wasEmpty ? 'Добавлено в список' : 'Список обновлён', 'success');
      logEvent('list.status_changed', { contentType, shikimoriId, from: status, to: next, source });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось. Попробуйте ещё раз.';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return { status, saving, choose };
}
