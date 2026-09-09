import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import CatalogArea from '@/components/catalog/CatalogArea';
import CatalogToolbar from '@/components/catalog/CatalogToolbar';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import { CINEMA_FILTER_CONFIG } from '@/lib/cinemaFilters';
import {
  getCinemaCountriesFromIndex,
  getCinemaGenresFromIndex,
} from '@/lib/cinemaIndexQuery';
import type { FilterOptionDef } from '@/lib/catalogFilters';

/**
 * Каркас каталога кино — те же компоненты, что и у аниме, отличается только
 * конфиг фильтров (lib/cinemaFilters.ts). Панель, шторка на телефоне,
 * поведение колонки и кнопка «Применить» общие.
 *
 * Жанры и страны тянутся из локального индекса (миграция 0027): у Videoseed
 * справочников нет вовсе, id и названия приходят вперемешку внутри карточек,
 * и словарь строится при индексации.
 */
async function CinemaFilters({ children }: { children: React.ReactNode }) {
  // Индекса может ещё не быть (первый запуск, не отработал крон) — тогда
  // списки пустые, и панель просто не рисует эти две группы. Ошибки тут не
  // бросаются в принципе, см. lib/cinemaIndexQuery.ts.
  const [genres, countries] = await Promise.all([
    getCinemaGenresFromIndex(),
    getCinemaCountriesFromIndex(),
  ]);

  const toOptions = (rows: { id: number; name: string }[] | null): FilterOptionDef[] =>
    (rows ?? []).map((r) => ({ value: String(r.id), label: r.name }));

  const options = {
    genres: toOptions(genres),
    countries: toOptions(countries),
  };

  return (
    <CatalogFilterProvider config={CINEMA_FILTER_CONFIG}>
      <CatalogArea
        options={options}
        header={
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold">Каталог кино</h1>
            <CatalogMobileTrigger />
          </div>
        }
        toolbar={<CatalogToolbar />}
      >
        {children}
      </CatalogArea>

      <CatalogMobileDrawer options={options} />
    </CatalogFilterProvider>
  );
}

export default function CinemaCatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* ModeSwitch снаружи Suspense: он ни от каких данных не зависит и
          должен появляться сразу, не дожидаясь справочников. */}
      <ModeSwitch active="cinema" />

      {/* Suspense — из-за useSearchParams внутри провайдера: без него сборка
          падает на пререндере. Заодно закрывает и await за справочниками. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <CinemaFilters>{children}</CinemaFilters>
      </Suspense>
    </div>
  );
}
