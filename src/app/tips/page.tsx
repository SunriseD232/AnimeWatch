import Link from 'next/link';

export const metadata = { title: 'Подсказки — MediaWatch' };

interface PlayerNote {
  name: string;
  status: 'exact' | 'partial' | 'none';
  note: string;
}

const CINEMA_PLAYERS: PlayerNote[] = [
  {
    name: 'Наш плеер',
    status: 'exact',
    note: 'Свой проксирующий плеер — позиция берётся прямо из видео, сохраняется каждые 10 секунд и при уходе со страницы.',
  },
  {
    name: 'Vibix',
    status: 'exact',
    note: 'Плеер сам сообщает точное время воспроизведения через мост postMessage.',
  },
  {
    name: 'Kodik',
    status: 'exact',
    note: 'Плеер сам сообщает точное время воспроизведения через мост postMessage.',
  },
  {
    name: 'Videoseed',
    status: 'partial',
    note: 'Плеер не сообщает ни время, ни play/pause — позиция оценивается приблизительно (по кликам, полноэкранному режиму и т.д.). Перемотки внутри самого плеера сайт не видит, поэтому после них позиция может разойтись с реальной.',
  },
];

const ANIME_PLAYERS: PlayerNote[] = [
  {
    name: 'AniLibria (наш HLS-плеер)',
    status: 'exact',
    note: 'Свой плеер — позиция берётся прямо из видео.',
  },
  {
    name: 'Наш плеер',
    status: 'exact',
    note: 'Свой проксирующий плеер (озвучки Alloha/Sibnet/Aksor) — позиция берётся прямо из видео.',
  },
  {
    name: 'Kodik',
    status: 'exact',
    note: 'Плеер сам сообщает точное время воспроизведения через мост postMessage.',
  },
  {
    name: 'Yummy',
    status: 'partial',
    note: 'Зависит от выбранной озвучки: если это Kodik-эмбед — позиция точная (те же события, что у вкладки «Kodik»); для остальных балансеров (Alloha/Sibnet/Aksor) протокол обмена неизвестен — сохраняется только отметка «начали смотреть эту серию», без точной секунды.',
  },
];

const STATUS_LABEL: Record<PlayerNote['status'], string> = {
  exact: 'Точная позиция',
  partial: 'Приблизительно',
  none: 'Не сохраняется',
};

const STATUS_CLASS: Record<PlayerNote['status'], string> = {
  exact: 'bg-emerald-500/15 text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-300',
  none: 'bg-gray-500/15 text-gray-400',
};

function PlayerRow({ player }: { player: PlayerNote }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-bg-card p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-100">{player.name}</span>
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[player.status]}`}
        >
          {STATUS_LABEL[player.status]}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-gray-400">{player.note}</p>
    </div>
  );
}

export default function TipsPage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold">Подсказки</h1>
        <p className="mt-1 text-sm text-gray-400">
          Что стоит знать про плееры на сайте.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            Запоминание позиции просмотра по плеерам
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            Переключатель «Плеер» над видео — это разные источники, и не все
            из них умеют сообщать сайту точное время воспроизведения. Если
            позиция сериала «уехала» после переключения или перемотки —
            вероятно, дело в источнике ниже с пометкой «Приблизительно».
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Фильмы и сериалы
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {CINEMA_PLAYERS.map((p) => (
                <PlayerRow key={p.name} player={p} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Аниме
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {ANIME_PLAYERS.map((p) => (
                <PlayerRow key={p.name} player={p} />
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-gray-500">
          Совет: если для тайтла доступен «Наш плеер» — позиция там всегда
          точная и сохраняется автоматически. Остальные источники — запасной
          вариант на случай, если «Наш плеер» недоступен для конкретной
          серии.
        </p>
      </section>

      <Link
        href="/"
        className="press w-fit rounded-full bg-bg-card px-4 py-2 text-sm font-medium text-gray-300 ring-1 ring-white/10 transition hover:bg-bg-soft hover:text-white"
      >
        ← На главную
      </Link>
    </div>
  );
}
