'use client';

import { useCallback, useRef } from 'react';

/**
 * Подбор замены, когда выбранная озвучка не открылась.
 *
 * У источника бывает битым ровно одно сочетание «серия × озвучка»: проверено
 * вживую на проде — «Адский рай 2», серия 3, «AniLibria · Alloha» отдаёт 502
 * и на обычный запрос, и на переизвлечение, при этом та же озвучка на серии 4
 * и другие озвучки той же серии открываются нормально. Без замены зритель
 * упирается в «Не удалось загрузить видео», а обновление страницы выбирает то
 * же самое — выхода нет вовсе, потому что сохранённое предпочтение указывает
 * именно на это сочетание.
 *
 * ЖИВЁТ В РОДИТЕЛЕ НАМЕРЕННО. Текущая озвучка есть и в состоянии OwnPlayer, и
 * в состоянии родителя, они догоняют друг друга с задержкой в один рендер.
 * Пока замену пробовал делать сам плеер, писателей становилось три и они
 * толкались бесконечно (см. комментарий у Props.onTranslationUnavailable в
 * OwnPlayer). Здесь писатель один.
 */
export interface FallbackTrack {
  id: number;
  title: string;
}

export function useTranslationFallback({
  tracks,
  episodeKey,
  onPick,
  onSwitched,
  limit = 3,
}: {
  /** Полный список озвучек текущей серии — из него и выбираем. */
  tracks: readonly FallbackTrack[];
  /** Меняется вместе с серией: пометки «не открылась» живут в её пределах. */
  episodeKey: string;
  /** Применить выбранную замену (обычно setState с id). */
  onPick: (id: number) => void;
  /** Замена состоялась — место для предупреждения зрителю. */
  onSwitched?: (next: FallbackTrack) => void;
  /** Сколько замен подряд разрешено в одной серии. */
  limit?: number;
}) {
  const failedRef = useRef<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() });
  const warnedRef = useRef<Set<string>>(new Set());

  return useCallback(
    (id: number, silent = false): boolean => {
      const failed = failedRef.current;
      if (failed.key !== episodeKey) {
        failed.key = episodeKey;
        failed.ids = new Set();
      }
      failed.ids.add(id);

      // Потолок не косметический: у тайтла бывает под сорок озвучек, и если
      // серии нет ВОВСЕ (не открывается ни одна), без него плеер молча
      // простучал бы весь список, вместо того чтобы честно сказать зрителю,
      // что серия недоступна.
      if (failed.ids.size > limit) return false;

      const current = tracks.find((t) => t.id === id);
      // «Озвучка AniLibria · Alloha» → студия «Озвучка AniLibria», источник
      // «Alloha». Сначала ищем ту же студию у ДРУГОГО источника: для зрителя
      // это ровно то, что он выбирал, просто с другой полки.
      const studio = current ? current.title.split(' · ')[0] : null;
      const untried = tracks.filter((t) => !failed.ids.has(t.id));
      const next =
        (studio ? untried.find((t) => t.title.split(' · ')[0] === studio) : undefined) ??
        untried[0];
      if (!next) return false;

      onPick(next.id);
      // Предупреждаем один раз на серию: замен подряд может быть несколько,
      // и плеер отдельно предупреждает про ненайденные субтитры — три
      // одинаковых сообщения подряд это уже шум, а не помощь.
      // silent — плеер сейчас не на экране (играет в причале, пока человек
      // ходит по сайту). Замену делаем, предупреждение придержим: тост
      // посреди профиля или каталога выглядит взявшимся из ниоткуда.
      if (!silent && !warnedRef.current.has(episodeKey)) {
        warnedRef.current.add(episodeKey);
        onSwitched?.(next);
      }
      return true;
    },
    [tracks, episodeKey, onPick, onSwitched, limit],
  );
}
