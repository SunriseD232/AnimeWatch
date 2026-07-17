'use client';

import { useEffect, useRef } from 'react';
import type { VibixEmbed } from '@/lib/video/vibix';

/**
 * Встройка плеера Vibix по официальной схеме: тег <ins data-*> + их SDK,
 * который сканирует документ и создаёт iframe плеера внутри тега.
 *
 * SDK выполняет сканирование при исполнении скрипта, поэтому при каждом
 * монтировании (смена серии/сезона) добавляем свежий экземпляр скрипта —
 * браузерный кэш делает повторные загрузки мгновенными.
 *
 * События/команды плеера (playerEvent/playerCommand) обрабатываются выше,
 * в Player.tsx — здесь только DOM-встройка.
 */

const VIBIX_SDK_SRC = 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js';

interface Props {
  embed: VibixEmbed;
  /** Сезон (только для сериалов). */
  season?: number | null;
  /** Серия (только для сериалов): плейлист ограничивается этой серией,
   * навигация по сериям остаётся на нашей странице. */
  episode?: number | null;
  isSerial: boolean;
}

export default function VibixPlayer({
  embed,
  season,
  episode,
  isSerial,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.innerHTML = '';

    const ins = document.createElement('ins');
    ins.setAttribute('data-publisher-id', embed.publisherId);
    ins.setAttribute('data-type', embed.type);
    ins.setAttribute('data-id', embed.id);
    if (isSerial && season && season > 0) {
      ins.setAttribute('data-season', String(season));
    }
    if (isSerial && episode && episode > 0) {
      ins.setAttribute('data-episodes', String(episode));
    }
    ins.setAttribute('data-width', '100%');
    ins.setAttribute('data-height', '100%');
    box.appendChild(ins);

    const script = document.createElement('script');
    script.src = VIBIX_SDK_SRC;
    script.async = true;
    box.appendChild(script);

    return () => {
      box.innerHTML = '';
    };
  }, [embed.publisherId, embed.type, embed.id, isSerial, season, episode]);

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full [&_ins]:block [&_ins]:h-full [&_ins]:w-full"
    />
  );
}
