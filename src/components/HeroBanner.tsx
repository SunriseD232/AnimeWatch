'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import QuickListButton from '@/components/QuickListButton';
import { PauseIcon, PlayIcon } from '@/components/social/icons';
import type { HeroData } from '@/lib/recommendations';

/**
 * Hero-баннер главной — карусель по всей подборке рекомендаций
 * (lib/recommendations.ts → getHeroPicks: «нравится пользователю И достаточно
 * популярно», у чего уже скачан backdrop).
 *
 * РАНЬШЕ это был один тайтл, выбранный случайно на каждой перезагрузке, а вся
 * подборка лежала отдельной каруселью мелких карточек ниже. Теперь подборка
 * живёт здесь: слайды переключаются сами раз в 10 секунд и вручную — по
 * полоскам под кнопками, стрелками с клавиатуры и свайпом на телефоне.
 *
 * children — слот под ModeSwitch: тот же компонент, что и раньше, просто
 * рендерится оверлеем поверх картинки.
 *
 * Высота фиксирована (не аспект-рейшо): на десктопе она же — высота соседней
 * колонки «Продолжить просмотр» (grid items-stretch). На мобильном подобрана
 * компромиссом: backdrop почти всегда 16:9 (1280×720), а слишком высокий
 * узкий контейнер обрезает половину ширины кадра по бокам (object-cover
 * масштабирует по высоте — раз она меньше, обрезка идёт по ширине), живьём
 * это превращало сцену в случайный крупный план.
 */

/** Сколько держится один слайд. Столько же длится заливка его полоски —
 *  полоска и есть индикатор этого таймера, поэтому число одно на оба. */
const SLIDE_MS = 10_000;

export default function HeroBanner({
  heroes,
  children,
}: {
  heroes: HeroData[];
  children?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Пауза «от наведения» отдельно от нажатой кнопки: увести мышь не должно
  // отменять осознанную остановку, и наоборот.
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = heroes.length;
  const hero = heroes[Math.min(index, count - 1)];

  // Человек попросил систему не анимировать — не крутим карусель сами
  // (WCAG 2.3.3/2.2.2: автодвижение здесь не несёт информации, которую
  // нельзя получить иначе — все слайды доступны по полоскам).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const running = count > 1 && !paused && !hovered && !reducedMotion;

  // Один таймер на активный слайд, а не общий интервал: при переключении
  // вручную эффект перезапускается, и следующий слайд получает свои полные
  // 10 секунд — иначе он сменился бы через мгновение, доедая остаток
  // чужого отсчёта.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, running, count]);

  // Вкладка в фоне — браузер всё равно душит таймеры, но CSS-анимация
  // полоски продолжает идти: вернувшись, человек увидел бы полную полоску на
  // слайде, который никуда не уехал. Проще остановить всё явно.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!hero) return null;

  const titleHref = hero.contentType === 'anime' ? `/anime/${hero.id}` : `/cinema/${hero.id}`;
  const meta = [hero.genres[0], hero.year, hero.rating ? hero.rating.toFixed(1) : null].filter(
    (v): v is string | number => v !== null && v !== undefined && v !== '',
  );

  const go = (next: number) => setIndex(((next % count) + count) % count);

  return (
    <section
      aria-roledescription="карусель"
      aria-label="Рекомендуем посмотреть"
      className="relative h-[46vh] min-h-[260px] max-h-[360px] w-full overflow-hidden rounded-3xl bg-bg-card lg:h-[440px] lg:max-h-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = touchStartX.current;
        touchStartX.current = null;
        if (from === null || count < 2) return;
        const delta = (e.changedTouches[0]?.clientX ?? from) - from;
        // 40px — порог, ниже которого это вертикальная прокрутка страницы с
        // небольшим боковым дрожанием пальца, а не свайп.
        if (Math.abs(delta) < 40) return;
        go(delta < 0 ? index + 1 : index - 1);
      }}
    >
      {/* Все backdrop'ы лежат слоями, видимый — с opacity 1: так смена слайда
          это плавное растворение, а не мигание белым на момент загрузки
          следующего файла. Картинки локальные (/backdrops/...), лишнего
          трафика от этого нет. */}
      {heroes.map((h, i) => (
        <div
          key={`${h.contentType}:${h.id}`}
          aria-hidden="true"
          className={[
            'absolute inset-0 transition-opacity duration-700 ease-out',
            i === index ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          {/* object-top — backdrop почти всегда широкий (16:9 и шире), а hero
              на мобильном высокий и узкий; object-cover с дефолтным center на
              такой пропорции вырезает случайную вертикальную полосу по центру
              кадра. Смысловой центр у постеров/backdrop чаще в верхней
              половине.

              hero-pan — очень медленный наезд (25 секунд на проход): за 10
              секунд слайда кадр успевает сдвинуться ровно настолько, чтобы
              картинка не выглядела мёртвой, и недостаточно, чтобы это
              отвлекало от текста поверх. Идёт только на активном слайде —
              крутить анимацию на девяти невидимых картинках значит зря
              жечь батарею. */}
          <PosterImage
            sources={[h.backdropUrl]}
            alt=""
            priority={i === 0}
            className={[
              'h-full w-full object-cover object-top',
              i === index ? 'animate-hero-pan' : '',
            ].join(' ')}
            placeholderClassName="absolute inset-0 bg-bg-soft"
          />
        </div>
      ))}

      {/* Снизу сплошной — текст читается независимо от того, что на картинке. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      {children && <div className="absolute left-3 top-3 z-20 sm:left-4 sm:top-4">{children}</div>}

      {/* top-14/sm:top-16 — забронированная полоса под ModeSwitch сверху: без
          неё длинное название с описанием на невысоком баннере разрастались
          вверх и перекрывали переключатель раздела. */}
      <div className="absolute inset-x-0 bottom-0 top-14 z-10 flex flex-col justify-end gap-3 overflow-hidden p-4 sm:top-16 sm:p-6">
        {/* key — чтобы текст нового слайда не подменялся мгновенно, а
            всплывал: смена картинки идёт 700 мс, и резкая подмена подписи
            посреди неё читалась как сбой. */}
        <div key={`${hero.contentType}:${hero.id}`} className="animate-hero-text flex flex-col gap-3">
          {hero.genres.length > 0 && (
            <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {hero.genres.map((g) => (
                <span
                  key={g}
                  className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-gray-200 backdrop-blur"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Не <h1>: заголовок страницы — отдельный sr-only h1 в page.tsx, а
              это promo-название конкретного тайтла. Кликабельно — ведёт на ту
              же карточку, что и «Смотреть». */}
          <Link
            href={titleHref}
            className="line-clamp-2 w-fit text-2xl font-bold text-white transition hover:underline sm:text-4xl"
          >
            {hero.title}
          </Link>

          {meta.length > 0 && <p className="text-sm text-gray-300 sm:text-base">{meta.join(' · ')}</p>}

          {hero.description && (
            <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-gray-300 sm:line-clamp-3">
              {hero.description}
            </p>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <Link
            href={titleHref}
            className="press flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover sm:flex-none"
          >
            <PlayIcon className="h-4 w-4" filled />
            Смотреть
          </Link>
          <QuickListButton
            shikimoriId={hero.id}
            contentType={hero.contentType}
            title={hero.title}
            posterUrl={null}
          />
        </div>

        {count > 1 && (
          <HeroTabs
            heroes={heroes}
            index={index}
            running={running}
            paused={paused}
            onPick={go}
            onTogglePause={() => setPaused((p) => !p)}
          />
        )}
      </div>

      {/* Смену слайда озвучиваем отдельно: сам текст выше подменяется без
          события, о котором скринридер узнал бы сам. */}
      <p aria-live="polite" className="sr-only">
        Слайд {index + 1} из {count}: {hero.title}
      </p>
    </section>
  );
}

/**
 * Полоски-страницы под кнопками: каждая — и индикатор, и кнопка перехода.
 * Активная заливается за те же 10 секунд, что живёт слайд, поэтому видно не
 * только «где я», но и «сколько осталось».
 *
 * Полоска как таргет тонкая (4 пикселя), поэтому у кнопки есть прозрачные
 * поля сверху и снизу: сам таргет — 24 пикселя по высоте, как требует WCAG
 * 2.5.8, а видимая полоска остаётся тонкой.
 */
function HeroTabs({
  heroes,
  index,
  running,
  paused,
  onPick,
  onTogglePause,
}: {
  heroes: HeroData[];
  index: number;
  running: boolean;
  paused: boolean;
  onPick: (next: number) => void;
  onTogglePause: () => void;
}) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <div
        role="tablist"
        aria-label="Слайды рекомендаций"
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = (index + step + heroes.length) % heroes.length;
          onPick(next);
          // Фокус едет за выбором — обычная модель табов с ручной
          // активацией стрелками (см. ту же в PlayerSettings).
          const tabs = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          tabs[next]?.focus();
        }}
      >
        {heroes.map((h, i) => (
          <button
            key={`${h.contentType}:${h.id}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            // Название тайтла в подписи, а не «слайд 3»: по номеру непонятно,
            // куда ведёт кнопка.
            aria-label={`${h.title}, слайд ${i + 1} из ${heroes.length}`}
            onClick={() => onPick(i)}
            className="group flex min-w-0 flex-1 items-center py-2.5 focus-visible:outline-none"
          >
            <span
              className={[
                'relative h-1 w-full overflow-hidden rounded-full transition-colors',
                i === index ? 'bg-white/30' : 'bg-white/20 group-hover:bg-white/35',
                'group-focus-visible:ring-2 group-focus-visible:ring-white group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black/60',
              ].join(' ')}
            >
              {i === index && (
                <span
                  // key — чтобы анимация начиналась заново на каждом слайде,
                  // а не продолжала предыдущий отсчёт.
                  key={`fill:${index}`}
                  className={[
                    'absolute inset-y-0 left-0 rounded-full bg-white',
                    running ? 'animate-hero-progress' : 'w-full',
                  ].join(' ')}
                />
              )}
            </span>
          </button>
        ))}
      </div>

      {/* WCAG 2.2.2: у движения, которое началось само, должна быть остановка.
          Наведение мышью и так ставит карусель на паузу, но с клавиатуры и с
          телефона нужна явная кнопка. */}
      <button
        type="button"
        onClick={onTogglePause}
        aria-pressed={paused}
        aria-label={paused ? 'Продолжить показ слайдов' : 'Остановить показ слайдов'}
        className="press grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
      >
        {paused ? <PlayIcon className="h-3.5 w-3.5" filled /> : <PauseIcon className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
