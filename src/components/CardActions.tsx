'use client';

import type { RefObject } from 'react';
import ExpandTitleButton from '@/components/ExpandTitleButton';
import QuickListButton from '@/components/QuickListButton';
import type { ContentType } from '@/lib/types';

/**
 * Пара кнопок в углу карточки каталога/главной: «+» (добавить в список) и
 * «i» (раскрыть обрезанное название). Обе одного вида — матовый кружок,
 * как кнопки в уведомлениях.
 *
 * Раскладывает их флекс-ряд, поэтому «i» здесь без своего абсолютного
 * позиционирования (standalone=false); «i» к тому же прячется, когда
 * название и так влезло целиком — тогда в углу остаётся один «+».
 */
export default function CardActions({
  shikimoriId,
  contentType,
  title,
  posterUrl,
  expanded,
  onToggleExpand,
  titleRef,
}: {
  shikimoriId: number;
  contentType: ContentType;
  title: string;
  posterUrl: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  titleRef: RefObject<HTMLElement>;
}) {
  return (
    <div className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1.5">
      <QuickListButton
        shikimoriId={shikimoriId}
        contentType={contentType}
        title={title}
        posterUrl={posterUrl}
      />
      <ExpandTitleButton
        expanded={expanded}
        onToggle={onToggleExpand}
        titleRef={titleRef}
        standalone={false}
      />
    </div>
  );
}
