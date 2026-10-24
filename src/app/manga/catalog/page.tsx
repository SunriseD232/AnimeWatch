import { ReadingCatalogResults } from '@/components/reading/ReadingCatalog';

export const metadata = { title: 'Каталог манги — MediaWatch' };

export const dynamic = 'force-dynamic';

export default function CatalogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return <ReadingCatalogResults kind="manga" searchParams={searchParams} />;
}
