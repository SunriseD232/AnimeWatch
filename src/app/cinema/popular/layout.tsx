import ModeSwitch from '@/components/ModeSwitch';

export default function PopularCinemaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="cinema" />

      <div>
        <h1 className="text-xl font-bold">Популярное</h1>
        <p className="text-sm text-gray-400">
          Топ фильмов и сериалов по рейтингу TMDB.
        </p>
      </div>

      {children}
    </div>
  );
}
