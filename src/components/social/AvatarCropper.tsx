'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AVATAR_MAX_BYTES } from '@/lib/social/types';
import { MinusIcon, PlusIcon } from './icons';

/**
 * Кадрирование аватара: квадрат 1:1 из загруженной картинки.
 *
 * Картинку двигают пальцем или мышью, приближают колесом, щипком, ползунком
 * или клавишами. Круг поверх показывает, что попадёт в аватар: сам аватар
 * круглый, и квадратная рамка обещала бы углы, которых не будет.
 *
 * РАЗМЕР. Режем в браузере и отправляем уже вырезанный кадр стороной не больше
 * OUTPUT_MAX px — это десятки-сотни килобайт, даже если исходник весил
 * двадцать мегабайт. Так «больше 5 МБ» перестаёт быть отказом: большая
 * фотография с телефона просто ужимается до нужного. Сервер всё равно
 * пережимает результат в WebP 512 px (lib/social/avatar.ts), здесь лишь
 * запас качества под это.
 */

const OUTPUT_MAX = 1024;
const MAX_ZOOM = 4;
const KEY_STEP = 12;

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

export default function AvatarCropper({ file, onCancel, onConfirm }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState(0);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const titleId = useId();
  const hintId = useId();
  const zoomId = useId();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Сторона рамки — от ширины диалога: на телефоне 320 px, на широком экране
  // до 20rem. Меряем, а не задаём, чтобы расчёт кадра шёл в настоящих пикселях.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setSide(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const baseScale = natural && side ? side / Math.min(natural.w, natural.h) : 1;

  /** Держит картинку так, чтобы она всегда закрывала рамку целиком. */
  const clamp = useCallback(
    (next: View): View => {
      if (!natural || !side) return next;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const scale = baseScale * zoom;
      const w = natural.w * scale;
      const h = natural.h * scale;
      return {
        zoom,
        x: Math.min(0, Math.max(side - w, next.x)),
        y: Math.min(0, Math.max(side - h, next.y)),
      };
    },
    [natural, side, baseScale],
  );

  // Первый показ — по центру.
  useEffect(() => {
    if (!natural || !side) return;
    const scale = baseScale;
    setView({ zoom: 1, x: (side - natural.w * scale) / 2, y: (side - natural.h * scale) / 2 });
  }, [natural, side, baseScale]);

  /** Масштаб вокруг точки (cx, cy) рамки — то, что под пальцем, остаётся под пальцем. */
  const zoomAround = useCallback(
    (nextZoom: number, cx = side / 2, cy = side / 2) => {
      setView((prev) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
        const ratio = zoom / prev.zoom;
        return clamp({ zoom, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio });
      });
    },
    [clamp, side],
  );

  // Модальность: фокус внутрь, Escape закрывает, Tab не уходит из диалога,
  // страница под диалогом не прокручивается.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frameRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, [tabindex="0"]',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onCancel]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAround(
        pinch.current.zoom * (distance / pinch.current.distance),
        (a.x + b.x) / 2 - rect.left,
        (a.y + b.y) / 2 - rect.top,
      );
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomAround(view.zoom * 1.1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomAround(view.zoom / 1.1);
    }
  }

  async function confirm() {
    const img = imgRef.current;
    if (!img || !natural || !side) return;
    setBusy(true);
    try {
      const scale = baseScale * view.zoom;
      const cropSide = side / scale;
      const out = Math.max(1, Math.round(Math.min(OUTPUT_MAX, cropSide)));
      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -view.x / scale, -view.y / scale, cropSide, cropSide, 0, 0, out, out);

      let quality = 0.92;
      let blob: Blob | null = null;
      // Сторона 1024 px в JPEG почти никогда не дотягивает до 5 МБ, но
      // картинка из сплошного шума может — тогда снижаем качество.
      for (let attempt = 0; attempt < 5; attempt++) {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob || blob.size <= AVATAR_MAX_BYTES) break;
        quality -= 0.15;
      }
      if (!blob || blob.size > AVATAR_MAX_BYTES) throw new Error('size');
      onConfirm(blob);
    } catch {
      setError('Не получилось вырезать кадр. Попробуйте другое изображение.');
      setBusy(false);
    }
  }

  const scale = baseScale * view.zoom;

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="glass-panel flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-white/10 p-5 shadow-2xl"
      >
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-gray-100">
            Кадр для аватара
          </h2>
          <p id={hintId} className="mt-0.5 text-sm text-gray-400">
            Перетащите картинку, чтобы нужное попало в круг. Приблизить — ползунком, колесом или двумя пальцами.
          </p>
        </div>

        <div
          ref={frameRef}
          tabIndex={0}
          role="group"
          aria-label="Область кадра. Стрелки двигают картинку, плюс и минус — масштаб."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            zoomAround(view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top);
          }}
          onKeyDown={onKeyDown}
          className="relative aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-black active:cursor-grabbing"
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setError('Не удалось открыть изображение. Подойдёт JPEG, PNG, WebP или GIF.')}
              style={
                natural
                  ? {
                      width: natural.w * scale,
                      height: natural.h * scale,
                      transform: `translate(${view.x}px, ${view.y}px)`,
                    }
                  : { opacity: 0 }
              }
              className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
            />
          )}
          {/* Затемнение вокруг круга: всё, что вне его, в аватар не попадёт. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-white/70"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => zoomAround(view.zoom / 1.2)}
            aria-label="Отдалить"
            className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 ring-1 ring-white/10 transition hover:bg-white/5"
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <label htmlFor={zoomId} className="sr-only">
            Масштаб
          </label>
          <input
            id={zoomId}
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomAround(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-[rgb(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => zoomAround(view.zoom * 1.2)}
            aria-label="Приблизить"
            className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 ring-1 ring-white/10 transition hover:bg-white/5"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="press rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/5"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!natural || !!error}
            aria-busy={busy}
            className="press rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
