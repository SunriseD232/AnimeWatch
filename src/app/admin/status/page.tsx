import { notFound } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { getCachedUser } from '@/lib/supabase/server';

export const metadata = { title: 'Состояние — MediaWatch' };
export const dynamic = 'force-dynamic';

/**
 * Состояние фоновых механизмов: индексы каталогов, рейтинги, кэш обложек.
 *
 * Зачем. Исход ночных прогонов до этого был виден только в логах PM2 (они
 * ротируются) и в state-таблицах, куда надо лезть руками через psql. Понять
 * «а индекс вообще обновлялся сегодня?» стоило SSH-сессии. Теперь это
 * страница.
 *
 * Доступ — как и у /admin/users: только ADMIN_EMAILS, остальным notFound(),
 * чтобы сам факт существования страницы не светился.
 *
 * Читаем сервисным ключом: у cinema_index_state и anime_index_state есть
 * публичная политика чтения, но у poster_cache считать агрегаты обычным
 * клиентом дороже — RLS проверяется на каждой строке.
 */
export default async function AdminStatusPage() {
  const {
    data: { user },
  } = await getCachedUser();
  if (!isAdminEmail(user?.email)) notFound();

  const supabase = createServiceClient();

  const [animeState, cinemaState, animePosters, cinemaPosters, ratings] = await Promise.all([
    supabase.from('anime_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('cinema_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('poster_cache').select('*', { count: 'exact', head: true }).eq('kind', 'anime').gt('bytes', 0),
    supabase.from('poster_cache').select('*', { count: 'exact', head: true }).eq('kind', 'cinema').gt('bytes', 0),
    supabase.from('cinema_ratings').select('*', { count: 'exact', head: true }).not('rating', 'is', null),
  ]);

  const a = animeState.data as Record<string, unknown> | null;
  const c = cinemaState.data as Record<string, unknown> | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Состояние</h1>
        <p className="text-sm text-gray-400">
          Фоновые механизмы: индексы каталогов, рейтинги, кэш обложек.
        </p>
      </div>

      <Section title="Индекс аниме">
        <Row label="Тайтлов в активной партии" value={num(a?.titles_count)} />
        <Row label="Собран" value={stamp(a?.built_at)} ok={fresh(a?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(a?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(a?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(a?.last_error ?? '') || 'нет'} ok={!a?.last_error} />
      </Section>

      <Section title="Индекс кино">
        <Row label="Тайтлов в активной партии" value={num(c?.titles_count)} />
        <Row label="Собран" value={stamp(c?.built_at)} ok={fresh(c?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(c?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(c?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(c?.last_error ?? '') || 'нет'} ok={!c?.last_error} />
      </Section>

      <Section title="Рейтинги TMDB">
        <Row label="Тайтлов с рейтингом" value={num(ratings.count)} />
        <Row label="Проверено в последний прогон" value={num(c?.ratings_checked)} />
        <Row label="Прогон начат" value={stamp(c?.ratings_run_started_at)} />
        <Row
          label="Прогон завершён"
          value={stamp(c?.ratings_run_finished_at)}
          // Раз в неделю: две недели без завершённого прогона — уже повод
          // посмотреть логи.
          ok={fresh(c?.ratings_run_finished_at, 24 * 14)}
        />
        <Row label="Ошибка" value={String(c?.ratings_error ?? '') || 'нет'} ok={!c?.ratings_error} />
      </Section>

      <Section title="Кэш обложек">
        <Row label="Скачано обложек аниме" value={num(animePosters.count)} />
        <Row label="Скачано обложек кино" value={num(cinemaPosters.count)} />
        <Row
          label="Покрытие аниме"
          value={percent(animePosters.count, a?.titles_count)}
          ok={ratio(animePosters.count, a?.titles_count) > 0.9}
        />
        <Row
          label="Покрытие кино"
          value={percent(cinemaPosters.count, c?.titles_count)}
          // У кино часть обложек не существует у самого апстрима, поэтому
          // сотни процентов тут не будет никогда — 90% это норма.
          ok={ratio(cinemaPosters.count, c?.titles_count) > 0.85}
        />
      </Section>

      <p className="text-xs text-gray-500">
        Расписание: индекс аниме — 5:00, индекс кино — 5:20, обложки — 5:40,
        рейтинги — воскресенье 4:00. Уведомления о новых сериях — 6:00
        (/etc/cron.d/mediawatch-check-episodes).
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-bg-card p-4">
      <h2 className="text-sm font-bold text-gray-100">{title}</h2>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  );
}

/** ok=false подсвечивает строку — то, на что стоит посмотреть. */
function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-1.5 last:border-b-0">
      <dt className="text-sm text-gray-400">{label}</dt>
      <dd
        className={[
          'text-right text-sm tabular-nums',
          ok === false ? 'font-semibold text-amber-400' : 'text-gray-100',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}

function num(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—';
}

function stamp(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  const ago = Date.now() - d.getTime();
  const hours = Math.floor(ago / 3_600_000);
  const suffix =
    hours < 1 ? 'меньше часа назад' : hours < 48 ? `${hours} ч назад` : `${Math.floor(hours / 24)} дн назад`;
  return `${d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${suffix}`;
}

/** Свежее ли значение — с запасом к расписанию, чтобы не мигать жёлтым из-за
 *  того, что прогон идёт прямо сейчас. */
function fresh(value: unknown, withinHours: number): boolean {
  if (!value) return false;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < withinHours * 3_600_000;
}

function ratio(part: unknown, total: unknown): number {
  const p = Number(part);
  const t = Number(total);
  return Number.isFinite(p) && Number.isFinite(t) && t > 0 ? p / t : 0;
}

function percent(part: unknown, total: unknown): string {
  const r = ratio(part, total);
  return r > 0 ? `${(r * 100).toFixed(1)}%` : '—';
}
