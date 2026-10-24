import { ReadingCatalogResults } from '@/components/reading/ReadingCatalog';

export const metadata = { title: 'Каталог аудиокниг — MediaWatch' };

export const dynamic = 'force-dynamic';

export default function CatalogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return <ReadingCatalogResults kind="audiobooks" searchParams={searchParams} />;
}
