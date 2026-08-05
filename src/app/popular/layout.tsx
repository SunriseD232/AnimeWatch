import ModeSwitch from '@/components/ModeSwitch';

export default function PopularLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      <div>
        <h1 className="text-xl font-bold">Популярное</h1>
        <p className="text-sm text-gray-400">
          Топ по рейтингу среди тайтлов {new Date().getFullYear()} года.
        </p>
      </div>

      {children}
    </div>
  );
}
