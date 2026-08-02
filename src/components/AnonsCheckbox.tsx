'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Чекбокс "Показывать анонсы" для главной (см. DiscoverTabs) — переключает
 * ?anons=1, сохраняя остальные текущие параметры (tab и т.п.) как есть:
 * читает их из адресной строки, а не пересобирает с нуля, как GenreFilterPanel
 * (там своя логика — жанры/сортировка, здесь параметров всего два).
 */
export default function AnonsCheckbox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const checked = searchParams.get('anons') === '1';

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.delete('anons');
    else params.set('anons', '1');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-gray-400">
      <input
        type="checkbox"
        checked={checked}
        onChange={toggle}
        className="h-4 w-4 rounded border-white/20 bg-bg-card accent-accent"
      />
      Показывать анонсы
    </label>
  );
}
