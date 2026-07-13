'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import type { ContentType, UserListStatus } from '@/lib/types';

const STATUS_OPTIONS: { value: UserListStatus; label: string }[] = [
  { value: 'watching', label: 'Смотрю' },
  { value: 'planned', label: 'В планах' },
  { value: 'completed', label: 'Просмотрено' },
  { value: 'dropped', label: 'Брошено' },
];

interface Props {
  shikimoriId: number;
  contentType?: ContentType;
  animeTitle: string;
  posterUrl: string | null;
  initialStatus: UserListStatus | null;
  isAuthed: boolean;
}

export default function ListButton({
  shikimoriId,
  contentType = 'anime',
  animeTitle,
  posterUrl,
  initialStatus,
  isAuthed,
}: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserListStatus | null>(
    initialStatus,
  );
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = STATUS_OPTIONS.find((o) => o.value === status);

  async function choose(next: UserListStatus | null) {
    setOpen(false);
    if (!isAuthed) {
      toast('Войдите, чтобы вести список', 'info');
      return;
    }
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
        toast('Удалено из списка', 'success');
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Нет сессии');
        const { error } = await supabase.from('user_list').upsert(
          {
            user_id: user.id,
            content_type: contentType,
            shikimori_id: shikimoriId,
            anime_title: animeTitle,
            poster_url: posterUrl,
            status: next,
          },
          { onConflict: 'user_id,content_type,shikimori_id' },
        );
        if (error) throw error;
        setStatus(next);
        toast('Список обновлён', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-bg-card px-4 py-2.5 text-sm font-medium text-gray-100 transition hover:bg-bg-soft disabled:opacity-60"
      >
        <span>{current ? current.label : '+ В список'}</span>
        <span className="text-gray-500">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-48 overflow-hidden rounded-lg border border-white/10 bg-bg-card shadow-xl">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              className={[
                'block w-full px-4 py-2.5 text-left text-sm transition hover:bg-bg-soft',
                status === o.value ? 'text-accent' : 'text-gray-200',
              ].join(' ')}
            >
              {o.label}
            </button>
          ))}
          {status && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="block w-full border-t border-white/10 px-4 py-2.5 text-left text-sm text-red-300 transition hover:bg-bg-soft"
            >
              Убрать из списка
            </button>
          )}
        </div>
      )}
    </div>
  );
}
