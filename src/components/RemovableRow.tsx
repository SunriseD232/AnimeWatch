'use client';

import { useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { XIcon } from '@/components/social/icons';
import type { ContentType } from '@/lib/types';

/**
 * Строка «Продолжить читать / слушать» с крестиком «убрать».
 *
 * Тот же приём, что у видео (ContinueCard): крестик по наведению (на
 * тач-устройствах — всегда, см. hover-reveal в globals.css), двухшаговое
 * подтверждение, удаление строки watch_progress клиентом пользователя (RLS
 * пускает только к своим). Ссылка-строка — children: кнопка лежит рядом с
 * ней, а не внутри, иначе клик по крестику открывал бы тайтл.
 *
 * После удаления строка прячется сама: router.refresh перерисовал бы всю
 * страницу каталога разом (см. тот же выбор в ContinueCard).
 */
export default function RemovableRow({
  contentType,
  id,
  title,
  children,
}: {
  contentType: ContentType;
  /** shikimori_id строки прогресса. */
  id: number;
  title: string;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function remove() {
    if (removing) return;
    setRemoving(true);
    const { error } = await createClient()
      .from('watch_progress')
      .delete()
      .eq('content_type', contentType)
      .eq('shikimori_id', id);
    if (error) {
      setRemoving(false);
      toast('Не удалось убрать. Попробуйте ещё раз.', 'error');
      return;
    }
    toast('Убрано из «Продолжить»', 'success');
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <div className="group relative">
      {children}
      {confirming ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-black/85 p-1 backdrop-blur">
          <button
            type="button"
            onClick={remove}
            aria-busy={removing}
            className="press rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500"
          >
            {removing ? 'Убираем…' : 'Убрать'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="press rounded-md px-2 py-1 text-xs text-gray-300 hover:text-white"
          >
            Отмена
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Убрать «${title}» из «Продолжить»`}
          title="Убрать из «Продолжить»"
          className="press hover-reveal absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white transition hover:bg-red-600"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
