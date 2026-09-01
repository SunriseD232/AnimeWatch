'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACCENT_PRESETS,
  BG_PRESETS,
  DEFAULT_THEME,
  applyTheme,
  isHexColor,
  readStoredTheme,
  storeTheme,
  type PaletteId,
  type Theme,
} from '@/lib/theme';

interface Props {
  /** Тема из БД, прочитанная на сервере при рендере профиля. */
  initialTheme: Theme;
}

/**
 * Профиль → «Оформление»: выбор акцента (интерфейс) и фоновой темы.
 *
 * Предпросмотр живой и применяется ко ВСЕЙ странице сразу при выборе, а не
 * к отдельному образцу в карточке: цвет оценивают по тому, как он смотрится
 * на реальном интерфейсе (шапка, карточки, кнопки), а квадратик-образец об
 * этом ничего не говорит. Отсюда и «Отменить» — вернуть последнее сохранённое
 * состояние, если наигрались.
 */
export default function ThemeSettings({ initialTheme }: Props) {
  const [saved, setSaved] = useState<Theme>(initialTheme);
  const [draft, setDraft] = useState<Theme>(initialTheme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Тема из БД — источник правды; синхронизируем зеркало в localStorage на
  // случай, когда на этом устройстве оно устарело или пусто (ThemeSync
  // делает то же самое, но профиль может открыться и раньше него).
  useEffect(() => {
    const stored = readStoredTheme();
    if (
      !stored ||
      stored.accent !== initialTheme.accent ||
      stored.palette !== initialTheme.palette
    ) {
      storeTheme(initialTheme);
      applyTheme(initialTheme);
    }
  }, [initialTheme]);

  // Живой предпросмотр — применяем черновик к документу на каждое изменение.
  useEffect(() => {
    applyTheme(draft);
  }, [draft]);

  // Уход со страницы с несохранённым черновиком не должен «утаскивать» чужой
  // цвет на остальной сайт — возвращаем сохранённое при размонтировании.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    return () => {
      applyTheme(savedRef.current);
    };
  }, []);

  const dirty = draft.accent !== saved.accent || draft.palette !== saved.palette;

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: draft }),
      });
      if (!res.ok) throw new Error('save failed');

      const { theme } = (await res.json()) as { theme: Theme };
      setSaved(theme);
      setDraft(theme);
      storeTheme(theme);
      applyTheme(theme);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      setError('Не удалось сохранить — попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(saved);
    setError(null);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-100">Оформление</p>
          <p className="mt-1 text-gray-400">
            Цвета применяются сразу — посмотрите, как сайт выглядит, и сохраните. Настройка
            привязана к аккаунту и подхватится на других устройствах.
          </p>
        </div>
        {justSaved && <span className="text-xs text-accent">Сохранено</span>}
      </div>

      {/* ——— Интерфейс (акцент) ——— */}
      <div className="mt-5">
        <p className="font-medium text-gray-200">Интерфейс</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Кнопки, ссылки, активные вкладки, шкала перемотки в плеере
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const active = draft.accent === preset.value;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, accent: preset.value }))}
                aria-pressed={active}
                title={preset.label}
                className={`press flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                  active
                    ? 'border-accent bg-accent/15 text-gray-100'
                    : 'border-white/10 text-gray-300 hover:border-white/25'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20"
                  style={{ background: preset.value }}
                />
                {preset.label}
              </button>
            );
          })}
        </div>

        <label className="mt-3 flex flex-wrap items-center gap-3 text-gray-300">
          <span>Свой цвет</span>
          <input
            type="color"
            value={draft.accent}
            onChange={(e) => setDraft((d) => ({ ...d, accent: e.target.value.toLowerCase() }))}
            className="h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
            aria-label="Выбрать произвольный акцентный цвет"
          />
          {/* Ручной ввод — попасть пипеткой в конкретный оттенок из макета
              нельзя, а скопировать hex можно. Применяем только валидный,
              чтобы промежуточный ввод («#29») не сбрасывал предпросмотр. */}
          <input
            type="text"
            value={draft.accent}
            onChange={(e) => {
              const v = e.target.value.trim().toLowerCase();
              if (isHexColor(v)) setDraft((d) => ({ ...d, accent: v }));
            }}
            spellCheck={false}
            maxLength={7}
            className="w-24 rounded-lg border border-white/10 bg-bg-soft px-2 py-1 font-mono text-xs text-gray-200 outline-none focus:border-accent"
            aria-label="Акцентный цвет в формате HEX"
          />
        </label>
      </div>

      {/* ——— Основная тема (фон) ——— */}
      <div className="mt-6">
        <p className="font-medium text-gray-200">Основная тема</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Фон страницы и карточек. Все варианты тёмные — интерфейс построен на светлом тексте.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {BG_PRESETS.map((preset) => {
            const active = draft.palette === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, palette: preset.id as PaletteId }))}
                aria-pressed={active}
                className={`press rounded-xl border p-3 text-left transition ${
                  active ? 'border-accent' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {[preset.bg, preset.soft, preset.card].map((c) => (
                    <span
                      key={c}
                      className="h-4 w-4 rounded-full ring-1 ring-white/15"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <p className="mt-2 font-medium text-gray-100">{preset.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-gray-500">{preset.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ——— Действия ——— */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="press rounded-full bg-accent px-4 py-2 font-medium text-black transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={!dirty || saving}
          className="press rounded-full border border-white/10 px-4 py-2 text-gray-300 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Отменить
        </button>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_THEME)}
          disabled={saving}
          className="press px-2 py-2 text-gray-400 underline-offset-4 transition hover:text-gray-200 hover:underline disabled:opacity-40"
        >
          Вернуть стандартные
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
