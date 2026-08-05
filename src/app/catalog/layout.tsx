import { Suspense } from 'react';
import GenreFilterPanel from '@/components/GenreFilterPanel';
import ModeSwitch from '@/components/ModeSwitch';
import { ANIME_CATALOG_SORTS, getAnimeGenres, type AnimeCatalogSort } from '@/lib/shikimori';

const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

async function GenresPanel() {
  let genres: { id: number; russian: string }[] = [];
  try {
    genres = await getAnimeGenres();
  } catch {
    genres = [];
  }
  return (
    <GenreFilterPanel
      genres={genres.map((g) => ({ value: String(g.id), label: g.russian }))}
      sorts={[...ANIME_CATALOG_SORTS]}
      defaultSort={DEFAULT_SORT}
      anonsToggle
    />
  );
}

export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      <div>
        <h1 className="text-xl font-bold">Каталог аниме</h1>
        <p className="text-sm text-gray-400">
          Выбирайте жанры (клик — включить, ещё раз — исключить), сочетайте
          несколько сразу.
        </p>
      </div>

      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <GenresPanel />
      </Suspense>

      {children}
    </div>
  );
}
