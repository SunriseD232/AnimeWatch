'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Checkbox from '@/components/Checkbox';

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
    // Смена фильтра — сбрасываем пагинацию (как и GenreFilterPanel): иначе
    // можно остаться на пустой странице N нового набора.
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return <Checkbox checked={checked} onChange={toggle} label="Показывать анонсы" />;
}
