'use client';

import { useEffect } from 'react';
import { applyTheme, readStoredTheme, storeTheme, type Theme } from '@/lib/theme';

/**
 * Подтягивает тему из БД и обновляет ею зеркало в localStorage — это и есть
 * кросс-девайс часть настройки: на новом устройстве localStorage пуст,
 * ThemeScript применить нечего, и тема приезжает отсюда.
 *
 * Запрос один на загрузку приложения и намеренно дешёвый (одна строка по
 * первичному ключу). Применяем результат только если он отличается от уже
 * применённого — иначе на каждом заходе была бы лишняя перерисовка стилей.
 */
export default function ThemeSync() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/theme');
        if (!res.ok || cancelled) return;

        // theme === null — гость: сервер про его тему ничего не знает, и
        // затирать локальный выбор дефолтом нельзя (см. route.ts).
        const { theme } = (await res.json()) as { theme: Theme | null };
        if (!theme || cancelled) return;

        const current = readStoredTheme();
        if (current && current.accent === theme.accent && current.palette === theme.palette) {
          return;
        }

        storeTheme(theme);
        applyTheme(theme);
      } catch {
        // Офлайн/сеть отвалилась — остаётся то, что уже применено локально.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
