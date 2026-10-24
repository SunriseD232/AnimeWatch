'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_READER_SETTINGS,
  READER_SETTINGS_STORAGE_KEY,
  normalizeReaderSettings,
  type MangaReaderSettings,
} from '@/lib/mangaReaderSettings';

/** Пауза перед записью в профиль: ползунок яркости шлёт десятки изменений
 *  в секунду, а в базу нужна только последняя. */
const SAVE_DELAY_MS = 800;

function readStored(): MangaReaderSettings | null {
  try {
    const raw = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
    return raw ? normalizeReaderSettings(JSON.parse(raw)) : null;
  } catch {
    // Приватный режим, запрет хранилища, битый JSON — просто без копии.
    return null;
  }
}

function writeStored(settings: MangaReaderSettings): void {
  try {
    window.localStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // См. readStored.
  }
}

/**
 * Настройки читалки: что пришло из профиля (сервер прочитал до отрисовки),
 * иначе копия из браузера, иначе значения по умолчанию.
 *
 * Профиль главнее браузера: настроил на телефоне — на компьютере откроется
 * так же. Копию в браузере всё равно обновляем: без входа это единственное
 * место, а с входом — страховка на случай, если запись в профиль не прошла.
 */
export function useMangaReaderSettings(
  fromProfile: MangaReaderSettings | null,
  signedIn: boolean,
) {
  const [settings, setSettings] = useState<MangaReaderSettings>(
    fromProfile ?? DEFAULT_READER_SETTINGS,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<MangaReaderSettings | null>(null);

  // Копия из браузера — только после монтирования: на сервере её нет, и
  // чтение в начальном состоянии дало бы расхождение гидрации.
  useEffect(() => {
    if (fromProfile) {
      writeStored(fromProfile);
      return;
    }
    const stored = readStored();
    if (stored) setSettings(stored);
  }, [fromProfile]);

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next || !signedIn) return;
    // keepalive: настройку часто меняют прямо перед уходом со страницы.
    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaReader: next }),
      keepalive: true,
    }).catch(() => {
      // Не сохранилось в профиль — останется копия в браузере.
    });
  }, [signedIn]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (patch: Partial<MangaReaderSettings>) => {
      setSettings((current) => {
        const next = normalizeReaderSettings({ ...current, ...patch });
        writeStored(next);
        pending.current = next;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
        return next;
      });
    },
    [flush],
  );

  const reset = useCallback(() => update(DEFAULT_READER_SETTINGS), [update]);

  return { settings, update, reset };
}
