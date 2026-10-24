import { ReadingCatalogLayout } from '@/components/reading/ReadingCatalog';

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <ReadingCatalogLayout kind="manga">{children}</ReadingCatalogLayout>;
}
