import ModeSwitch from '@/components/ModeSwitch';

export default function NewAnimeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      <div>
        <h1 className="text-xl font-bold">Новинки</h1>
        <p className="text-sm text-gray-400">
          Последние вышедшие тайтлы, от новых к старым.
        </p>
      </div>

      {children}
    </div>
  );
}
