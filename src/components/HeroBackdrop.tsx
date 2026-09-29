'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BackdropId } from '@/lib/theme';

/**
 * Живой фон страниц с баннером (главная аниме и кино) — выбирается в профиле
 * → «Оформление» → «Фон главной» (см. BACKDROP_PRESETS в lib/theme.ts).
 *
 * Оба живых варианта состоят из двух слоёв:
 *  - «эхо баннера» — свечение за баннером в цветах ТЕКУЩЕГО слайда, плавно
 *    перетекающее при смене тайтла. Цвета считаются здесь же, из самой
 *    картинки: backdrop лежит на нашем домене (/backdrops/...), так что её
 *    можно прочитать через canvas без CORS и без доработок на сервере;
 *  - узор: «Созвездие» (плывущие точки с нитями) или «Топография»
 *    (изолинии по гладкому полю), тонированный акцентом профиля.
 *
 * Рисуется в фиксированный канвас за всем содержимым (портал в <body>,
 * z-index −1): так фон один на экран и не зависит от раскладки страницы.
 * Свечение гаснет по мере прокрутки — ниже баннера оно уже ни к чему, а
 * узор остаётся приглушённым.
 *
 * Бережём батарею: во вкладке в фоне не рисуем, изолинии пересчитываются раз
 * в ~100 мс, а не каждый кадр, канвас не выше 1.5× плотности экрана, на
 * узком экране звёзд вдвое меньше. При «уменьшить движение» — один
 * статичный кадр, перерисовка только при смене цветов или размера.
 */

type Rgb = [number, number, number];

/** Кэш цветов по адресу картинки: слайды крутятся по кругу. */
const paletteCache = new Map<string, [Rgb, Rgb]>();

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

/**
 * Два самых заметных цвета кадра. Пиксели раскладываем по 12 корзинам
 * оттенка с весом «насыщенность × яркость» — так серое небо и чёрные поля
 * не перебивают яркий акцент сцены. Затем подтягиваем насыщенность и
 * яркость до «светящихся»: тусклый коричневый кадр иначе дал бы грязное
 * свечение, неотличимое от отсутствия эффекта.
 */
function extractPalette(img: HTMLImageElement): [Rgb, Rgb] | null {
  const w = 48, h = 27;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const px: Rgb = [data[i], data[i + 1], data[i + 2]];
    const [hue, s, l] = rgbToHsl(px);
    const weight = s * (1 - Math.abs(l - 0.5) * 2) + 0.02;
    const bucket = buckets[Math.floor(hue / 30) % 12];
    bucket.w += weight;
    bucket.r += px[0] * weight;
    bucket.g += px[1] * weight;
    bucket.b += px[2] * weight;
  }
  const top = buckets
    .filter((b) => b.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 2)
    .map((b) => {
      const [hue, s] = rgbToHsl([b.r / b.w, b.g / b.w, b.b / b.w]);
      return hslToRgb(hue, Math.max(0.55, Math.min(1, s * 1.3)), 0.52);
    });
  if (top.length === 0) return null;
  return [top[0], top[1] ?? top[0]];
}

function readAccent(): Rgb {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const parts = raw.split(/\s+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n))
    ? (parts as Rgb)
    : [41, 151, 255];
}

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a})`;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Гладкое поле для изолиний — сумма синусоид вместо шума: дёшево, без
 *  таблиц, и линии получаются плавными, как рельеф, а не рваными. */
const field = (x: number, y: number, s: number) =>
  Math.sin(x * 1.3 + s) +
  Math.sin(y * 1.7 - s * 0.8) +
  Math.sin((x + y) * 0.9 + s * 0.5) +
  Math.sin(Math.hypot(x - 2, y - 1) * 1.6 - s * 0.6);

const TOPO_LEVELS = [-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4];

function useBackdropSetting(): BackdropId {
  const [value, setValue] = useState<BackdropId>('plain');
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const v = root.dataset.backdrop;
      setValue(v === 'stars' || v === 'topo' ? v : 'plain');
    };
    read();
    // Тема может приехать с сервера уже после монтирования (ThemeSync).
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-backdrop', 'style'] });
    return () => mo.disconnect();
  }, []);
  return value;
}

export default function HeroBackdrop({ imageUrl }: { imageUrl: string }) {
  const mode = useBackdropSetting();
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Цвета эха: откуда и куда идёт переход и когда он начался.
  const echoRef = useRef<{ from: [Rgb, Rgb]; to: [Rgb, Rgb]; at: number } | null>(null);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => setMounted(true), []);

  // Цвета текущего слайда.
  useEffect(() => {
    if (mode === 'plain') return;
    let cancelled = false;
    const apply = (pal: [Rgb, Rgb]) => {
      if (cancelled) return;
      const now = performance.now();
      const prev = echoRef.current;
      // Стартуем переход от того цвета, что на экране прямо сейчас, а не от
      // прошлой цели: быстрый клик по полоскам не должен давать рывок.
      const current: [Rgb, Rgb] = prev
        ? (() => {
            const t = Math.min(1, (now - prev.at) / 1200);
            return [mixRgb(prev.from[0], prev.to[0], t), mixRgb(prev.from[1], prev.to[1], t)];
          })()
        : pal;
      echoRef.current = { from: current, to: pal, at: now };
      redrawRef.current();
    };
    const cached = paletteCache.get(imageUrl);
    if (cached) {
      apply(cached);
    } else {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const pal = extractPalette(img);
        if (pal) {
          paletteCache.set(imageUrl, pal);
          apply(pal);
        }
      };
      img.src = imageUrl;
    }
    return () => {
      cancelled = true;
    };
  }, [imageUrl, mode]);

  // Отрисовка.
  useEffect(() => {
    if (mode === 'plain' || !mounted) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1;
    let accent = readAccent();
    let stars: { x: number; y: number; vx: number; vy: number; r: number; tw: number }[] = [];
    const topo = document.createElement('canvas');
    let topoAt = -Infinity;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      topo.width = canvas.width;
      topo.height = canvas.height;
      topoAt = -Infinity;
      const n = W < 640 ? 32 : 64;
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.2 + 0.4,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const drawEcho = (t: number, fade: number) => {
      const echo = echoRef.current;
      if (!echo || fade <= 0) return;
      const k = Math.min(1, (t - echo.at) / 1200);
      const e = k * k * (3 - 2 * k);
      const c0 = mixRgb(echo.from[0], echo.to[0], e);
      const c1 = mixRgb(echo.from[1], echo.to[1], e);
      // Баннер — в левой колонке верха страницы; свечение исходит из-за него.
      const cx = W * (W < 1024 ? 0.5 : 0.36), cy = Math.min(H * 0.32, 320);
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
      g.addColorStop(0, rgba(c0, 0.4 * fade));
      g.addColorStop(0.45, rgba(c0, 0.11 * fade));
      g.addColorStop(1, rgba(c0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(W * 0.72, H * 0.08, 0, W * 0.72, H * 0.08, Math.max(W, H) * 0.45);
      g.addColorStop(0, rgba(c1, 0.26 * fade));
      g.addColorStop(1, rgba(c1, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };

    const drawStars = (t: number, animate: boolean) => {
      const link = Math.min(W, 1400) * 0.1;
      if (animate) {
        for (const p of stars) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
        }
      }
      ctx.lineWidth = 0.7;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i], b = stars[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < link) {
            ctx.strokeStyle = rgba(accent, 0.2 * (1 - d / link));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (const p of stars) {
        const tw = 0.55 + 0.45 * Math.sin(t / 900 + p.tw);
        ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.4 * tw})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawTopo = (t: number) => {
      if (t - topoAt > 100) {
        topoAt = t;
        const o = topo.getContext('2d');
        if (!o) return;
        o.setTransform(dpr, 0, 0, dpr, 0, 0);
        o.clearRect(0, 0, W, H);
        const cell = Math.max(12, W / 110);
        const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
        const sc = 8.8 / Math.max(W, 800);
        const s = (t / 1000) * 0.12;
        const v = new Float32Array(cols * rows);
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) v[j * cols + i] = field(i * cell * sc, j * cell * sc, s);
        TOPO_LEVELS.forEach((L, li) => {
          o.beginPath();
          for (let j = 0; j < rows - 1; j++) {
            for (let i = 0; i < cols - 1; i++) {
              const a = v[j * cols + i], b = v[j * cols + i + 1];
              const c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
              const x = i * cell, y = j * cell;
              const pts: number[] = [];
              const edge = (p: number, q: number, x1: number, y1: number, x2: number, y2: number) => {
                if (p > L !== q > L) {
                  const k = (L - p) / (q - p);
                  pts.push(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
                }
              };
              edge(a, b, x, y, x + cell, y);
              edge(b, c, x + cell, y, x + cell, y + cell);
              edge(c, d, x + cell, y + cell, x, y + cell);
              edge(d, a, x, y + cell, x, y);
              for (let p = 0; p + 3 < pts.length; p += 4) {
                o.moveTo(pts[p], pts[p + 1]);
                o.lineTo(pts[p + 2], pts[p + 3]);
              }
            }
          }
          o.strokeStyle = rgba(accent, li === 3 ? 0.38 : 0.13 + (li % 2) * 0.05);
          o.lineWidth = li === 3 ? 1.1 : 0.8;
          o.stroke();
        });
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(topo, 0, 0);
      ctx.restore();
    };

    const draw = (t: number, animate: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const fade = Math.max(0, 1 - window.scrollY / 700);
      drawEcho(t, fade);
      if (mode === 'stars') drawStars(t, animate);
      else drawTopo(animate ? t : 0);
      // Низ экрана приглушаем: узор не должен спорить с лентами постеров.
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };

    let raf = 0;
    const loop = (t: number) => {
      raf = 0;
      if (document.hidden) return;
      draw(t, true);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduce) {
        // Статичный кадр: переход цветов сразу в конечное состояние.
        draw(performance.now() + 10_000, false);
      } else if (!raf) {
        raf = requestAnimationFrame(loop);
      }
    };
    redrawRef.current = start;

    const onResize = () => {
      resize();
      start();
    };
    const onScroll = () => {
      if (reduce) start();
    };
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    // Акцент поменяли (живой предпросмотр в профиле или ThemeSync) — узор
    // перекрашивается сразу.
    const mo = new MutationObserver(() => {
      accent = readAccent();
      topoAt = -Infinity;
      start();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    resize();
    start();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      redrawRef.current = () => {};
      mo.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode, mounted]);

  if (!mounted || mode === 'plain') return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />,
    document.body,
  );
}
