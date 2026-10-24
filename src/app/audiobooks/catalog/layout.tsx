import { ReadingCatalogLayout } from '@/components/reading/ReadingCatalog';

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <ReadingCatalogLayout kind="audiobooks">{children}</ReadingCatalogLayout>;
}
