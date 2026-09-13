'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  DISPLAY_NAME_MAX,
  normalizeDisplayName,
  validateDisplayName,
} from '@/lib/social/names';
import type { PublicUser } from '@/lib/social/types';
import Avatar from './Avatar';
import AvatarCropper from './AvatarCropper';
import { CameraIcon, PencilIcon } from './icons';

/**
 * Шапка своего профиля: аватар, отображаемое имя, почта.
 *
 * Почта подписана «видна только вам» — это единственное место, где она
 * вообще показывается, и человеку стоит знать, что остальные видят имя.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif';

// Потолок на исходник перед кадрированием. Это не лимит аватара (кадр
// ужимается в браузере до сотен килобайт, см. AvatarCropper), а защита вкладки:
// декодировать стомегабайтную панораму браузер может и не пережить.
const SOURCE_MAX_BYTES = 50 * 1024 * 1024;

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

export default function ProfileIdentity({
  initialUser,
  email,
  actions,
}: {
  initialUser: PublicUser;
  email: string | null;
  /** Кнопка «Выйти» — серверная форма, приходит готовой. */
  actions: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState(initialUser);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialUser.hasCustomName ? initialUser.name : '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const nameFieldId = useId();
  const nameHintId = useId();

  function startEditing() {
    setName(user.hasCustomName ? user.name : '');
    setNameError(null);
    setEditing(true);
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const next = normalizeDisplayName(name);
    if (next.length > 0) {
      const problem = validateDisplayName(next);
      if (problem) {
        setNameError(problem);
        return;
      }
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: next }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось сохранить имя. Попробуйте ещё раз.'));
      const data = (await res.json()) as { user: PublicUser };
      setUser(data.user);
      setEditing(false);
      toast(next ? 'Имя сохранено' : 'Имя убрано', 'success');
      router.refresh();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Не удалось сохранить имя.');
    } finally {
      setSavingName(false);
    }
  }

  function pickFile(file: File) {
    setAvatarError(null);
    if (file.type && !file.type.startsWith('image/')) {
      setAvatarError('Это не изображение. Подойдёт JPEG, PNG, WebP или GIF.');
      return;
    }
    if (file.size > SOURCE_MAX_BYTES) {
      setAvatarError('Файл больше 50 МБ. Выберите изображение поменьше.');
      return;
    }
    // Любой размер до потолка идёт в кадрирование: вырезанный кадр ужимается
    // в браузере, и лимит сервера в 5 МБ ему не страшен.
    setCropFile(file);
  }

  async function uploadAvatar(blob: Blob) {
    setCropFile(null);
    setAvatarError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' }));
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось загрузить аватар. Попробуйте ещё раз.'));
      const data = (await res.json()) as { user: PublicUser };
      setUser(data.user);
      toast('Аватар обновлён', 'success');
      router.refresh();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Не удалось загрузить аватар.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeAvatar() {
    setConfirmRemove(false);
    setAvatarError(null);
    setUploading(true);
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось убрать аватар. Попробуйте ещё раз.'));
      const data = (await res.json()) as { user: PublicUser };
      setUser(data.user);
      toast('Аватар убран', 'success');
      router.refresh();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Не удалось убрать аватар.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <div className="relative" aria-busy={uploading}>
          <Avatar user={user} size="xl" className="ring-1 ring-white/10" />
          {uploading && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/60">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
              <span className="sr-only">Загружаем аватар</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={user.avatarUrl ? 'Сменить аватар' : 'Загрузить аватар'}
            title={user.avatarUrl ? 'Сменить аватар' : 'Загрузить аватар'}
            className="press absolute -bottom-1 -right-1 grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-fg ring-4 ring-bg transition hover:bg-accent-hover disabled:cursor-wait"
          >
            <CameraIcon className="h-[1.125rem] w-[1.125rem]" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {user.avatarUrl && !uploading && !confirmRemove && (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="min-h-6 rounded-full px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
          >
            Убрать фото
          </button>
        )}
        {confirmRemove && (
          <div className="flex items-center gap-1 text-xs" role="group" aria-label="Убрать фото">
            <button
              type="button"
              onClick={() => void removeAvatar()}
              className="press rounded-full bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700"
            >
              Убрать
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="press rounded-full px-3 py-1.5 font-medium text-gray-300 transition hover:bg-white/5"
            >
              Отмена
            </button>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
        {editing ? (
          <form onSubmit={saveName} className="flex w-full max-w-md flex-col gap-2" noValidate>
            <label htmlFor={nameFieldId} className="text-sm font-medium text-gray-200">
              Отображаемое имя
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={nameFieldId}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="nickname"
                autoFocus
                placeholder="Как вас называть"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameHintId}
                className={[
                  'min-w-0 flex-1 rounded-lg border bg-bg-soft px-3 py-2 text-sm text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1',
                  nameError
                    ? 'border-red-400/70 focus:border-red-400 focus:ring-red-400'
                    : 'border-white/10 focus:border-accent focus:ring-accent',
                ].join(' ')}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  aria-busy={savingName}
                  className="press rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  {savingName ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="press rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/5"
                >
                  Отмена
                </button>
              </div>
            </div>
            <p id={nameHintId} className={nameError ? 'text-sm text-red-300' : 'text-xs text-gray-400'} role={nameError ? 'alert' : undefined}>
              {nameError ?? 'Его видят друзья и все, кто читает ваши комментарии. Оставьте пустым, чтобы убрать.'}
            </p>
          </form>
        ) : (
          <>
            <div className="flex max-w-full items-center gap-2">
              <h1 className="truncate text-4xl font-bold leading-tight">{user.name}</h1>
              <button
                type="button"
                onClick={startEditing}
                aria-label="Изменить имя"
                title="Изменить имя"
                className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
              >
                <PencilIcon className="h-4 w-4" />
              </button>
            </div>
            {!user.hasCustomName && (
              <button
                type="button"
                onClick={startEditing}
                className="text-sm font-medium text-accent hover:underline"
              >
                Задайте имя, чтобы друзья вас узнали
              </button>
            )}
          </>
        )}
        {email && (
          <p className="max-w-full truncate text-sm text-gray-400">
            {email} <span className="text-gray-400">· почта видна только вам</span>
          </p>
        )}
        {avatarError && (
          <p role="alert" className="text-sm text-red-300">
            {avatarError}
          </p>
        )}
      </div>

      <div className="flex justify-center sm:self-start">{actions}</div>

      {cropFile && (
        <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(blob) => void uploadAvatar(blob)} />
      )}
    </section>
  );
}
