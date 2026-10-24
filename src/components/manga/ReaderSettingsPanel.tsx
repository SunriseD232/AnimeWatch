'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRightIcon, XIcon } from '@/components/social/icons';
import {
  BRIGHTNESS_MIN,
  READER_HOTKEYS,
  TAP_ZONE_SCHEMES,
  WIDTH_MIN,
  tapZoneHint,
  tapZoneLabel,
  tapZonesFor,
  type MangaReaderSettings,
  type ReaderDirection,
  type TapAction,
  type TapZoneScheme,
} from '@/lib/mangaReaderSettings';

/**
 * Панель настроек читалки — выезжает справа поверх страниц, как у MangaLib.
 * Каждое изменение применяется сразу (читалка видна за панелью), сохраняет
 * его useMangaReaderSettings.
 *
 * Зоны нажатия — отдельный экран внутри панели: у них восемь схем, и каждой
 * нужна картинка, иначе «L-образное» ничего не говорит.
 */
export default function ReaderSettingsPanel({
  settings,
  onChange,
  onReset,
  onClose,
  signedIn,
}: {
  settings: MangaReaderSettings;
  onChange: (patch: Partial<MangaReaderSettings>) => void;
  onReset: () => void;
  onClose: () => void;
  signedIn: boolean;
}) {
  const [view, setView] = useState<'main' | 'zones' | 'keys'>('main');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Фокус в панель при открытии: с клавиатуры иначе пришлось бы табать
  // через всю читалку, чтобы добраться до настроек.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const paged = settings.mode === 'paged';

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Настройки читалки"
      className="absolute inset-y-0 right-0 z-30 flex w-[22rem] max-w-full flex-col border-l border-white/10 bg-bg-card/95 text-gray-100 shadow-2xl backdrop-blur"
      // Нажатия внутри панели не должны листать страницы под ней.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Клавиши читалки внутри панели не работают (стрелки здесь
        // переключают варианты), кроме Esc — он закрывает панель.
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        {view !== 'main' ? (
          <button
            type="button"
            onClick={() => setView('main')}
            aria-label="Назад к настройкам"
            className="press -ml-2 grid h-8 w-8 place-items-center rounded-full text-gray-300 hover:bg-white/10 hover:text-white"
          >
            <ChevronRightIcon className="h-4 w-4 rotate-180" />
          </button>
        ) : null}
        <h2 className="flex-1 text-base font-semibold">
          {view === 'zones' ? 'Зоны нажатия' : view === 'keys' ? 'Горячие клавиши' : 'Настройки'}
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Закрыть настройки"
          className="press grid h-8 w-8 place-items-center rounded-full text-gray-300 hover:bg-white/10 hover:text-white"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {view === 'zones' ? (
          <ZonesView settings={settings} onChange={onChange} />
        ) : view === 'keys' ? (
          <KeysView />
        ) : (
          <div className="flex flex-col gap-5">
            {!signedIn ? (
              <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-gray-400">
                Настройки сохраняются в этом браузере. Войдите, чтобы они были одинаковыми на всех
                устройствах.
              </p>
            ) : null}

            <Field label="Режим чтения">
              <Segmented
                value={settings.mode}
                onChange={(mode) => onChange({ mode })}
                options={[
                  { value: 'paged', label: 'Горизонтальный' },
                  { value: 'vertical', label: 'Вертикальный' },
                  { value: 'strip', label: 'Полоса' },
                ]}
              />
              <p className="mt-1.5 text-xs text-gray-500">
                {paged
                  ? 'По одной странице, листание нажатием, клавишами или свайпом.'
                  : settings.mode === 'vertical'
                    ? 'Лента страниц с промежутками, листание прокруткой.'
                    : 'Страницы встык, без промежутков — для вебтунов.'}
              </p>
            </Field>

            {paged ? (
              <>
                <Field label="Направление чтения">
                  <Segmented
                    value={settings.direction}
                    onChange={(direction) => onChange({ direction })}
                    options={[
                      { value: 'ltr', label: 'Слева направо' },
                      { value: 'rtl', label: 'Справа налево' },
                    ]}
                  />
                </Field>
                <Toggle
                  label="Разворот из двух страниц"
                  hint="Только на широком экране."
                  checked={settings.doublePage}
                  onChange={(doublePage) => onChange({ doublePage })}
                />
              </>
            ) : null}

            <Field label="Тема чтения">
              <Segmented
                value={settings.theme}
                onChange={(theme) => onChange({ theme })}
                options={[
                  { value: 'dark', label: 'Тёмная' },
                  { value: 'light', label: 'Светлая' },
                  { value: 'system', label: 'Системная' },
                ]}
              />
            </Field>

            <button
              type="button"
              onClick={() => setView('zones')}
              className="press flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-3 text-left hover:bg-white/10"
            >
              <span className="text-sm font-semibold">Зоны нажатия</span>
              <span className="flex items-center gap-1 text-sm text-gray-400">
                {tapZoneLabel(settings.tapZones)}
                <ChevronRightIcon className="h-4 w-4" />
              </span>
            </button>

            <Field label="Область переключения страниц">
              <Segmented
                value={settings.tapArea}
                onChange={(tapArea) => onChange({ tapArea })}
                options={[
                  { value: 'image', label: 'Изображение' },
                  { value: 'screen', label: 'Весь экран' },
                ]}
              />
            </Field>

            <Field label="Вместить изображения">
              <Segmented
                value={settings.fit}
                onChange={(fit) => onChange({ fit })}
                options={[
                  { value: 'width', label: 'По ширине' },
                  { value: 'height', label: 'По высоте экрана' },
                ]}
              />
            </Field>

            <Field label="Увеличение изображений">
              <Segmented
                value={settings.upscale ? 'yes' : 'no'}
                onChange={(v) => onChange({ upscale: v === 'yes' })}
                options={[
                  { value: 'no', label: 'Не увеличивать' },
                  { value: 'yes', label: 'Увеличивать' },
                ]}
              />
            </Field>

            <Slider
              label="Яркость"
              value={settings.brightness}
              min={BRIGHTNESS_MIN}
              onChange={(brightness) => onChange({ brightness })}
            />
            <Slider
              label="Ширина контейнера"
              value={settings.width}
              min={WIDTH_MIN}
              onChange={(width) => onChange({ width })}
            />

            <Field label="Полоса прогресса">
              <Segmented
                value={settings.progressBar}
                onChange={(progressBar) => onChange({ progressBar })}
                options={[
                  { value: 'hidden', label: 'Скрыта' },
                  { value: 'thin', label: 'Тонкая' },
                  { value: 'normal', label: 'Обычная' },
                ]}
              />
            </Field>
            {settings.progressBar !== 'hidden' ? (
              <Field label="Положение полосы">
                <Segmented
                  value={settings.progressPosition}
                  onChange={(progressPosition) => onChange({ progressPosition })}
                  options={[
                    { value: 'bottom', label: 'Снизу' },
                    { value: 'left', label: 'Слева' },
                    { value: 'right', label: 'Справа' },
                  ]}
                />
              </Field>
            ) : null}

            <div className="flex flex-col gap-2">
              <Toggle
                label="Скрыть номер страниц"
                checked={settings.hidePageNumber}
                onChange={(hidePageNumber) => onChange({ hidePageNumber })}
              />
              <Toggle
                label="Следующая глава после последней страницы"
                checked={settings.autoNextChapter}
                onChange={(autoNextChapter) => onChange({ autoNextChapter })}
              />
              <Toggle
                label="Прятать панель во весь экран"
                hint="Вернуть — нажатием в зону «Меню» или клавишей M."
                checked={settings.autoHideToolbar}
                onChange={(autoHideToolbar) => onChange({ autoHideToolbar })}
              />
            </div>

            <button
              type="button"
              onClick={() => setView('keys')}
              className="press flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-3 text-left text-sm font-semibold hover:bg-white/10"
            >
              Горячие клавиши
              <ChevronRightIcon className="h-4 w-4 text-gray-400" />
            </button>

            <button
              type="button"
              onClick={onReset}
              className="press w-fit text-sm text-gray-400 underline-offset-2 hover:text-white hover:underline"
            >
              Сбросить настройки
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex gap-1 rounded-xl bg-white/5 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={[
              'press min-w-0 flex-1 rounded-lg px-1 py-2 text-[13px] leading-tight transition [overflow-wrap:anywhere]',
              active ? 'bg-white/15 font-medium text-white' : 'text-gray-400 hover:text-white',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (100 - min)) * 100;
  return (
    <label className="flex flex-col gap-2 rounded-xl bg-white/5 px-3 py-3">
      <span className="text-sm font-semibold">
        {label} {value}%
      </span>
      <input
        type="range"
        min={min}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[rgb(var(--accent))]"
        style={{
          background: `linear-gradient(to right, rgb(var(--accent)) ${fill}%, rgb(var(--bg-soft)) ${fill}%)`,
        }}
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="press flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-3 text-left hover:bg-white/10"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">{label}</span>
        {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={[
          'relative h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'bg-white/20',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[1.125rem]' : 'left-0.5',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

// Цвета фиксированные, не акцент: акцент по умолчанию синий, и «Вперёд»
// акцентом сливался с синим «Назад». Подписи на большой схеме дублируют цвет.
const ACTION_STYLE: Record<TapAction, { className: string; label: string }> = {
  prev: { className: 'bg-amber-500/40 text-amber-50', label: 'Назад' },
  next: { className: 'bg-emerald-500/40 text-emerald-50', label: 'Вперёд' },
  menu: { className: 'bg-white/5 text-gray-400', label: 'Меню' },
};

/** Схема зон на макете экрана: те же прямоугольники, что проверяет
 *  tapActionAt, — картинка не может разойтись с поведением. */
export function TapZonesPreview({
  scheme,
  direction,
  className = '',
}: {
  scheme: TapZoneScheme;
  direction: ReaderDirection;
  className?: string;
}) {
  // Порядок зон — приоритет: первая подходящая побеждает. Рисуем в
  // обратном порядке, чтобы первая оказалась сверху, как и в проверке.
  const zones = [...tapZonesFor(scheme, direction)].reverse();
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 ${className}`}>
      {zones.length === 0 ? (
        <span className="absolute inset-0 grid place-items-center text-[11px] text-gray-400">Меню</span>
      ) : null}
      {zones.map((zone, i) => (
        <span
          key={i}
          className={`absolute grid place-items-center border border-black/30 text-[11px] font-medium ${ACTION_STYLE[zone.action].className}`}
          style={{
            left: `${zone.x * 100}%`,
            top: `${zone.y * 100}%`,
            width: `${zone.w * 100}%`,
            height: `${zone.h * 100}%`,
          }}
        >
          {ACTION_STYLE[zone.action].label}
        </span>
      ))}
    </div>
  );
}

function ZonesView({
  settings,
  onChange,
}: {
  settings: MangaReaderSettings;
  onChange: (patch: Partial<MangaReaderSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <TapZonesPreview
        scheme={settings.tapZones}
        direction={settings.direction}
        className="mx-auto aspect-[3/4] w-40"
      />
      <p className="text-center text-xs text-gray-400">{tapZoneHint(settings.tapZones)}</p>
      <div role="radiogroup" aria-label="Схема зон нажатия" className="flex flex-col gap-1">
        {TAP_ZONE_SCHEMES.map((scheme) => {
          const active = scheme === settings.tapZones;
          return (
            <button
              key={scheme}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ tapZones: scheme })}
              className={[
                'press flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                active ? 'bg-white/15 font-medium text-white' : 'text-gray-300 hover:bg-white/5',
              ].join(' ')}
            >
              <TapZonesPreview scheme={scheme} direction={settings.direction} className="aspect-[3/4] w-8 shrink-0 [&_span]:text-[0px]" />
              {tapZoneLabel(scheme)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Зоны работают в режиме «Горизонтальный». В ленте «Вперёд» и «Назад» прокручивают на экран.
        Справа налево зоны «Назад» и «Вперёд» меняются местами.
      </p>
    </div>
  );
}

function KeysView() {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {READER_HOTKEYS.map((hotkey) => (
        <div key={hotkey.keys} className="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <dt className="shrink-0 font-mono text-xs text-white">{hotkey.keys}</dt>
          <dd className="text-right text-xs text-gray-400">{hotkey.action}</dd>
        </div>
      ))}
    </dl>
  );
}
