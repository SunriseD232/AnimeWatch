import { CardGridSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="skeleton h-6 w-64" />
      <CardGridSkeleton count={12} />
    </div>
  );
}
