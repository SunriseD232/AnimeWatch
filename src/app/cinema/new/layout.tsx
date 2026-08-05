import ModeSwitch from '@/components/ModeSwitch';

export default function NewCinemaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="cinema" />

      <div>
        <h1 className="text-xl font-bold">Новинки</h1>
        <p className="text-sm text-gray-400">
          Последние добавленные фильмы и сериалы, от новых к старым (по году).
        </p>
      </div>

      {children}
    </div>
  );
}
