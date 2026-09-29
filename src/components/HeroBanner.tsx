'use client';

import { useEffect, useRef, useState } from 'react';
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
 * Переключателя раздела поверх картинки больше нет — он переехал в шапку
 * (см. HeaderNav.tsx), и баннер отдаёт под текст всю свою высоту.
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

export default function HeroBanner({ heroes }: { heroes: HeroData[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Фокус внутри баннера держит слайд на месте, но ТОЛЬКО когда он стоит на
  // ссылке или кнопке «в список»: у них при смене слайда меняется адрес, и
  // человек нажал бы Enter уже на другом тайтле. Полоски и сама кнопка паузы
  // сюда не входят — иначе клик по полоске останавливал бы показ навсегда.
  const [focusHeld, setFocusHeld] = useState(false);
  // Курсор над баннером — показ ждёт. Раньше пауза по наведению была
  // сделана грубо: отсчёт начинался заново, и на слайде, над которым
  // подержали мышь, он фактически не кончался. Теперь остаток времени
  // сохраняется (см. remainingRef) и после увода курсора доигрывается.
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Вкладка не на экране — крутить нечего. Отдельным состоянием, а не общей
  // паузой: возвращение на вкладку не должно отменять нажатую человеком
  // кнопку паузы, и наоборот.
  const [visible, setVisible] = useState(true);
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

  const running = count > 1 && !paused && !focusHeld && !hovered && !reducedMotion && visible;

  /**
   * Сколько этому слайду ещё висеть. Пауза не обнуляет отсчёт, а
   * замораживает его: увели курсор — слайд доигрывает свой остаток, а не
   * начинает десять секунд заново. Полоска под кнопками ведёт себя так же
   * (CSS-анимация встаёт на паузу, а не перезапускается), поэтому картинка и
   * индикатор не расходятся.
   */
  const remainingRef = useRef(SLIDE_MS);
  /** Слайд сменился сам — следующему причитаются полные десять секунд. */
  const advancedRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const wait = remainingRef.current;
    const timer = setTimeout(() => {
      advancedRef.current = true;
      setIndex((i) => (i + 1) % count);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (advancedRef.current) {
        // Отсчёт кончился, слайд уехал — новому полный срок.
        advancedRef.current = false;
        remainingRef.current = SLIDE_MS;
        return;
      }
      // Остановили посередине — запоминаем, сколько не доиграли.
      remainingRef.current = Math.max(0, wait - (Date.now() - startedAt));
    };
  }, [index, running, count]);

  // Вкладка в фоне — браузер всё равно душит таймеры, но CSS-анимация
  // полоски продолжает идти: вернувшись, человек увидел бы полную полоску на
  // слайде, который никуда не уехал. Проще остановить всё явно.
  //
  // Начальное значение читаем В ЭФФЕКТЕ, а не при рендере: на сервере
  // document нет, а разметка должна совпасть с клиентской.
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Живой фон сайта (SiteBackdrop в layout) красит свечение в цвета
  // картинки ТЕКУЩЕГО слайда — сообщаем её атрибутом на <html>. Уходим со
  // страницы — убираем, и фон возвращается к цвету акцента.
  const heroImage = hero?.backdropUrl;
  useEffect(() => {
    if (!heroImage) return;
    const root = document.documentElement;
    root.dataset.heroImage = heroImage;
    return () => {
      if (root.dataset.heroImage === heroImage) delete root.dataset.heroImage;
    };
  }, [heroImage]);

  if (!hero) return null;

  const titleHref = hero.contentType === 'anime' ? `/anime/${hero.id}` : `/cinema/${hero.id}`;
  // Жанра здесь нет намеренно: он уже показан чипами прямо над названием, и
  // в строке «Сёнен · 2019 · 8.4» повторялся вторым слова в слово.
  const meta = [hero.year, hero.rating ? hero.rating.toFixed(1) : null].filter(
    (v): v is string | number => v !== null && v !== undefined && v !== '',
  );

  // Ручное переключение — всегда с полного отсчёта: человек выбрал слайд,
  // и он не должен смениться через секунду, доедая чужой остаток.
  const go = (next: number) => {
    remainingRef.current = SLIDE_MS;
    advancedRef.current = false;
    setIndex(((next % count) + count) % count);
  };

  return (
    <section
      aria-roledescription="карусель"
      aria-label="Рекомендуем посмотреть"
      className="relative h-[46vh] min-h-[260px] max-h-[360px] w-full overflow-hidden rounded-3xl bg-bg-card lg:h-[440px] lg:max-h-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        if (!(e.target as HTMLElement).closest('[data-hero-controls]')) setFocusHeld(true);
      }}
      onBlur={() => setFocusHeld(false)}
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
      {/* Backdrop'ы лежат слоями, видимый — с opacity 1: так смена слайда это
          плавное растворение, а не мигание пустым местом на время загрузки
          следующего файла.

          Но держим В РАЗМЕТКЕ только три: текущий, следующий и предыдущий.
          Все десять сразу — это 0,9 МБ картинок на первой отрисовке главной
          (замерено на проде: в среднем 93 КБ на файл), из которых девять
          человек не видит. Соседние нужны: следующий должен быть готов к
          моменту растворения, предыдущий — чтобы шаг назад был таким же
          мгновенным. */}
      {heroes.map((h, i) => {
        const near =
          i === index || i === (index + 1) % count || i === (index - 1 + count) % count;
        if (!near) return null;
        return (
        <div
          key={`${h.contentType}:${h.id}`}
          aria-hidden="true"
          className={[
            'absolute inset-0 transition-opacity duration-500 ease-out',
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
        );
      })}

      {/* Снизу сплошной — текст читается независимо от того, что на картинке. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      <div className="absolute inset-0 z-10 flex flex-col justify-end gap-3 overflow-hidden p-4 sm:p-6">
        {/* key — чтобы текст нового слайда не подменялся мгновенно, а
            всплывал: смена картинки идёт 500 мс, и резкая подмена подписи
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
            // lg:text-5xl — на широком экране заголовок должен быть заметно
            // крупнее текста страницы (правило дизайн-системы: не меньше
            // 2.5× базового кегля). На 36px выходило 2.25×, и баннер читался
            // как «жирный абзац», а не как главный объект экрана.
            className="line-clamp-2 w-fit text-2xl font-bold text-white transition hover:underline sm:text-4xl lg:text-5xl"
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
          {/* key — обязателен. Кнопка помнит выбранный статус у себя в
              состоянии (см. useQuickListStatus), а при смене слайда React
              переиспользовал бы тот же экземпляр: добавив один тайтл в
              список, галочку было видно и на всех следующих слайдах, а
              попытка поставить тот же статус другому тайтлу молча ничего не
              делала (choose выходит, если статус «не изменился»). С ключом
              на каждый тайтл кнопка начинается заново. */}
          <QuickListButton
            key={`${hero.contentType}:${hero.id}`}
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
    <div data-hero-controls className="mt-1 flex items-center gap-2">
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
                  // animation-play-state, а не снятие класса: пауза
                  // замораживает заливку на месте, и после возврата курсора
                  // она доигрывает остаток — ровно как и сам таймер слайда.
                  style={{ animationPlayState: running ? 'running' : 'paused' }}
                  className="animate-hero-progress absolute inset-y-0 left-0 rounded-full bg-white"
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
