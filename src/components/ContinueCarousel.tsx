'use client';

import { useState } from 'react';
import ContinueCard from '@/components/ContinueCard';
import ScrollCarousel from '@/components/ScrollCarousel';
import type { WatchProgress } from '@/lib/types';

export interface ContinueEntry {
  progress: WatchProgress;
  localPoster: string | null;
  isMultiSeason: boolean;
}

/**
 * Карусель «Продолжить просмотр». Держит список на клиенте, чтобы убранная
 * карточка исчезала ЦЕЛИКОМ вместе со своей ячейкой.
 *
 * Раньше ContinueCard прятал сам себя (возвращал null), но обёртка
 * `w-56 shrink-0` оставалась в серверной разметке — на её месте зиял пустой
 * столбец шириной с карточку до перезагрузки страницы. Теперь удаление
 * поднято сюда: карточка сообщает об успехе колбэком, а ячейку из потока
 * убирает уже этот компонент.
 */
export default function ContinueCarousel({ entries }: { entries: ContinueEntry[] }) {
  const [list, setList] = useState(entries);

  return (
    <ScrollCarousel className="carousel-room flex snap-x gap-3 overflow-x-auto">
      {list.map((e) => (
        <div key={e.progress.id} className="w-56 shrink-0 snap-start sm:w-72">
          <ContinueCard
            progress={e.progress}
            isMultiSeason={e.isMultiSeason}
            localPoster={e.localPoster}
            onRemoved={() => setList((prev) => prev.filter((x) => x.progress.id !== e.progress.id))}
          />
        </div>
      ))}
    </ScrollCarousel>
  );
}
