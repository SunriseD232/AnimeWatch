'use client';

import { useEffect } from 'react';
import { storePreferredQuality, type PreferredQuality } from '@/lib/playerQuality';

/**
 * Переносит качество из аккаунта в localStorage этого устройства.
 *
 * Плеер читает качество синхронно — прямо в обработчике манифеста hls.js,
 * где ждать сетевой запрос негде (см. OwnPlayer). Поэтому источник правды
 * для него localStorage, а аккаунт — то, из чего это зеркало наполняется на
 * устройствах, где включена синхронизация.
 *
 * Значения приходят пропами из Navbar: он и так на каждой странице читает
 * profiles ради аватара, так что отдельного запроса на это не появляется.
 *
 * Переносим только при включённой синхронизации и только когда в аккаунте
 * что-то выбрано: иначе выключенная синхронизация или нетронутая настройка
 * затирали бы локальный выбор человека.
 */
export default function PlayerPrefsSync({
  quality,
  sync,
}: {
  quality: PreferredQuality | null;
  sync: boolean;
}) {
  useEffect(() => {
    if (!sync || quality == null) return;
    storePreferredQuality(quality);
  }, [quality, sync]);

  return null;
}
