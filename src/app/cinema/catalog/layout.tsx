import { Suspense } from 'react';
import GenreFilterPanel from '@/components/GenreFilterPanel';
import ModeSwitch from '@/components/ModeSwitch';
import { CINEMA_CATALOG_SORTS, CINEMA_GENRES, type CinemaCatalogSort } from '@/lib/videoseed-catalog';

const DEFAULT_SORT: CinemaCatalogSort = 'new';

export default function CinemaCatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="cinema" />

      <div>
        <h1 className="text-xl font-bold">Каталог кино</h1>
        <p className="text-sm text-gray-400">
          Выбирайте жанры (клик — включить, ещё раз — исключить), сочетайте
          несколько сразу.
        </p>
      </div>

      <Suspense fallback={<div className="h-12 animate-pulse rounded-2xl bg-bg-card" />}>
        <GenreFilterPanel
          genres={CINEMA_GENRES.map((g) => ({ value: g, label: g }))}
          sorts={[...CINEMA_CATALOG_SORTS]}
          defaultSort={DEFAULT_SORT}
        />
      </Suspense>

      {children}
    </div>
  );
}
