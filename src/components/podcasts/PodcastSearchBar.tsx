'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DEFAULT_PODCAST_REGION,
  PODCAST_REGIONS,
  PODCAST_REGION_COOKIE,
  type PodcastRegion,
} from '@/lib/podcastShared';

/**
 * Поиск по подкастам: строка запроса + выбор региона.
 *
 * Обычная GET-форма, а не автопоиск по мере ввода. Причины две. Первая:
 * живой поиск уходит в iTunes по выбранному региону, и на каждый символ это
 * был бы отдельный сетевой запрос (плюс лимит Apple ~20 запросов в минуту).
 * Вторая: результат поиска — это адрес («/podcasts?q=…&region=ru»), а не
 * состояние виджета: его можно переслать, сохранить в закладки, вернуться
 * назад — и всё это работает без JavaScript.
 *
 * Регион пишем ещё и в куку: он влияет на живой поиск в iTunes, где
 * параметр country обязателен, и запоминать выбор нужно, иначе каждый заход
 * начинался бы с каталога США.
 */
export default function PodcastSearchBar({
  initialQuery,
  initialRegion,
}: {
  initialQuery: string;
  initialRegion: PodcastRegion;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [region, setRegion] = useState<PodcastRegion>(initialRegion);

  // initialQuery/initialRegion приходят из URL и меняются при переходах
  // (например, кнопкой «назад» или по ссылке «Продолжить слушать» с другим
  // регионом) — синхронизируем поля, иначе они показывали бы прошлый запрос.
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => setRegion(initialRegion), [initialRegion]);

  /**
   * Регион пишем в куку сразу при выборе, не дожидаясь отправки формы: он
   * влияет на живой поиск в iTunes (country обязателен), и запоминать выбор
   * нужно даже если человек потом просто ушёл на другую страницу. При
   * отправке формы тот же выбор уедет в URL.
   */
  function chooseRegion(next: PodcastRegion) {
    setRegion(next);
    document.cookie = `${PODCAST_REGION_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    const q = query.trim();
    if (q) next.set('q', q);
    if (region !== DEFAULT_PODCAST_REGION) next.set('region', region);
    const qs = next.toString();
    router.push(qs ? `/podcasts?${qs}` : '/podcasts');
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-gray-400"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-3.6-3.6" />
        </svg>
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название или автор — например, «реализация ИИ»"
          aria-label="Поиск подкастов"
          className="w-full rounded-full border border-white/10 bg-bg-card py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-gray-500 focus:border-accent"
        />
      </div>

      <label className="relative shrink-0">
        <span className="sr-only">Регион каталога</span>
        <select
          value={region}
          onChange={(e) => chooseRegion(e.target.value as PodcastRegion)}
          className="w-full appearance-none rounded-full border border-white/10 bg-bg-card py-2.5 pl-4 pr-9 text-sm outline-none transition focus:border-accent sm:w-auto"
        >
          {PODCAST_REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-gray-400"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </label>

      <button
        type="submit"
        className="press shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
      >
        Найти
      </button>
    </form>
  );
}
