import { notFound } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { getCachedUser } from '@/lib/supabase/server';
import RunJobButton from '@/components/admin/RunJobButton';
import ResetExtractorButton from '@/components/admin/ResetExtractorButton';
import { getExtractorHealth } from '@/lib/extractorHealth';
import { sourceTitleLabel } from '@/lib/sources/chapterLabel';
import type { SourceId } from '@/lib/sources/types';
import type { JobName } from '@/lib/adminJobs';

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

  const [animeState, cinemaState, podcastState, bookState, ranobeState, mangaState, animePosters, cinemaPosters, ratings, imdbGenres, extractor, sourceHealth, linkManga, linkRanobe, bookStorage, savedBooks] = await Promise.all([
    supabase.from('anime_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('cinema_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('podcast_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('book_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('ranobe_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('manga_index_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('poster_cache').select('*', { count: 'exact', head: true }).eq('kind', 'anime').gt('bytes', 0),
    supabase.from('poster_cache').select('*', { count: 'exact', head: true }).eq('kind', 'cinema').gt('bytes', 0),
    supabase.from('cinema_ratings').select('*', { count: 'exact', head: true }).not('rating', 'is', null),
    // Жанры из выгрузки IMDb (миграция 0040) — считаем только те строки, где
    // жанр реально есть: пустой массив означает «в выгрузке нашли, но ни один
    // жанр в наш справочник не переводится».
    supabase.from('cinema_imdb_genres').select('*', { count: 'exact', head: true }).not('genre_ids', 'eq', '{}'),
    // Отдельный процесс на этой же машине — см. lib/extractorHealth.ts, оно
    // никогда не бросает: если экстрактор лежит, страница должна об этом
    // сказать, а не упасть вместе с ним.
    getExtractorHealth(),
    // Источники чтения: здоровье и прогресс chunked-маппинга.
    supabase.from('source_health').select('*').order('source'),
    supabase.from('source_link_state').select('*').eq('job', 'manga').maybeSingle(),
    supabase.from('source_link_state').select('*').eq('job', 'ranobe').maybeSingle(),
    // Книги, сохранённые на сервере (миграция 0058).
    supabase.from('book_storage_state').select('*').eq('id', true).maybeSingle(),
    supabase.from('user_saved_books').select('*', { count: 'exact', head: true }),
  ]);

  const a = animeState.data as Record<string, unknown> | null;
  const c = cinemaState.data as Record<string, unknown> | null;
  const p = podcastState.data as Record<string, unknown> | null;
  const b = bookState.data as Record<string, unknown> | null;
  const r = ranobeState.data as Record<string, unknown> | null;
  const m = mangaState.data as Record<string, unknown> | null;

  const healthRows = (sourceHealth.data ?? []) as Record<string, unknown>[];
  const mLink = linkManga.data as Record<string, unknown> | null;
  const rLink = linkRanobe.data as Record<string, unknown> | null;
  const bs = bookStorage.data as Record<string, unknown> | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Состояние</h1>
        <p className="text-sm text-gray-400">
          Фоновые механизмы: индексы каталогов, рейтинги, кэш обложек.
        </p>
      </div>

      <Section title="Индекс аниме" jobs={['reindex-anime']}>
        <Row label="Тайтлов в активной партии" value={num(a?.titles_count)} />
        <Row label="Собран" value={stamp(a?.built_at)} ok={fresh(a?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(a?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(a?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(a?.last_error ?? '') || 'нет'} ok={!a?.last_error} />
      </Section>

      <Section title="Индекс кино" jobs={['reindex-cinema']}>
        <Row label="Тайтлов в активной партии" value={num(c?.titles_count)} />
        <Row label="Собран" value={stamp(c?.built_at)} ok={fresh(c?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(c?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(c?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(c?.last_error ?? '') || 'нет'} ok={!c?.last_error} />
      </Section>

      <Section title="Каталог подкастов" jobs={['reindex-podcasts']}>
        <Row label="Подкастов в активной партии" value={num(p?.titles_count)} />
        <Row label="Собран" value={stamp(p?.built_at)} ok={fresh(p?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(p?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(p?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(p?.last_error ?? '') || 'нет'} ok={!p?.last_error} />
      </Section>

      <Section title="Каталог книг" jobs={['reindex-books']}>
        <Row label="Книг в витрине" value={num(b?.titles_count)} />
        <Row label="Собран" value={stamp(b?.built_at)} ok={fresh(b?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(b?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(b?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(b?.last_error ?? '') || 'нет'} ok={!b?.last_error} />
      </Section>

      <Section title="Каталог ранобэ" jobs={['reindex-ranobe']}>
        <Row label="Тайтлов в витрине" value={num(r?.titles_count)} />
        <Row label="Собран" value={stamp(r?.built_at)} ok={fresh(r?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(r?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(r?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(r?.last_error ?? '') || 'нет'} ok={!r?.last_error} />
      </Section>

      <Section title="Каталог манги" jobs={['reindex-manga']}>
        <Row label="Тайтлов в витрине" value={num(m?.titles_count)} />
        <Row label="Собран" value={stamp(m?.built_at)} ok={fresh(m?.built_at, 48)} />
        <Row label="Последний запуск начат" value={stamp(m?.last_run_started_at)} />
        <Row label="Последний запуск завершён" value={stamp(m?.last_run_finished_at)} />
        <Row label="Ошибка" value={String(m?.last_error ?? '') || 'нет'} ok={!m?.last_error} />
      </Section>

      <Section title="Книги на сервере" jobs={['cleanup-saved-books']}>
        <Row label="Сохранений у пользователей" value={num(savedBooks.count)} />
        <Row
          label="Файлов на диске"
          value={`${num(bs?.files_count)} · ${Math.round(Number(bs?.bytes_total ?? 0) / 1024 / 1024)} МБ`}
        />
        <Row label="Очистка начата" value={stamp(bs?.last_run_started_at)} />
        <Row label="Очистка завершена" value={stamp(bs?.last_run_finished_at)} ok={fresh(bs?.last_run_finished_at, 48)} />
        <Row label="Ошибка" value={String(bs?.last_error ?? '') || 'нет'} ok={!bs?.last_error} />
      </Section>

      <Section
        title="Источники чтения"
        jobs={['link-manga-sources', 'link-ranobe-flibusta']}
      >
        {healthRows.length === 0 ? (
          <Row label="Источники" value="ещё не было запросов" />
        ) : (
          healthRows.map((row) => (
            <Row
              key={String(row.source)}
              label={
                sourceTitleLabel(String(row.source) as SourceId) ||
                String(row.source)
              }
              value={[
                row.enabled === false ? 'выкл' : 'вкл',
                `ошибок ${num(row.errors_24h)}`,
                row.last_error
                  ? `ошибка: ${String(row.last_error).slice(0, 80)}`
                  : stamp(row.last_ok_at),
              ].join(' · ')}
              ok={row.enabled !== false && !row.last_error}
            />
          ))
        )}

        <Row
          label="Маппинг манги"
          value={`${num(mLink?.titles_done)} тайтлов · ${stamp(mLink?.last_run_finished_at)}`}
        />
        <Row
          label="Ошибка маппинга манги"
          value={String(mLink?.last_error ?? '') || 'нет'}
          ok={!mLink?.last_error}
        />

        <Row
          label="Маппинг ранобэ"
          value={`${num(rLink?.titles_done)} тайтлов · ${stamp(rLink?.last_run_finished_at)}`}
        />
        <Row
          label="Ошибка маппинга ранобэ"
          value={String(rLink?.last_error ?? '') || 'нет'}
          ok={!rLink?.last_error}
        />
      </Section>

      <Section title="Рейтинги TMDB" jobs={['refresh-cinema-ratings']}>
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

      <Section title="Жанры IMDb" jobs={['refresh-cinema-genres']}>
        <Row label="Тайтлов с жанрами" value={num(imdbGenres.count)} />
        <Row label="Найдено в последний прогон" value={num(c?.genres_matched)} />
        <Row label="Прогон начат" value={stamp(c?.genres_run_started_at)} />
        <Row
          label="Прогон завершён"
          value={stamp(c?.genres_run_finished_at)}
          // Тот же недельный график, что у рейтингов.
          ok={fresh(c?.genres_run_finished_at, 24 * 14)}
        />
        <Row label="Ошибка" value={String(c?.genres_error ?? '') || 'нет'} ok={!c?.genres_error} />
      </Section>

      <Section title="Кэш обложек" jobs={['cache-posters']}>
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

      {/* Экстрактор — не крон, а живущий рядом процесс с Puppeteer. Его
          наработку раньше можно было увидеть только по SSH, хотя именно она
          первой объясняет «плеер грузится дольше обычного». */}
      <Section title="Экстрактор" extra={<ResetExtractorButton />}>
        <Row
          label="Доступен"
          value={extractor.reachable ? 'да' : 'нет'}
          ok={extractor.reachable}
        />
        {extractor.reachable && (
          <>
            <Row label="Процесс живёт" value={`${num(extractor.uptimeMinutes)} мин`} />
            <Row label="Память процесса" value={extractor.rssMb != null ? `${extractor.rssMb} МБ` : '—'} />
            <Row
              label="Chromium запущен"
              value={extractor.browser?.running ? 'да' : 'нет (поднимется по запросу)'}
            />
            <Row
              label="Извлечений на текущем Chromium"
              value={
                extractor.browser
                  ? `${num(extractor.browser.extractions)} из ${num(extractor.browser.maxExtractions)}`
                  : '—'
              }
              // Близко к порогу — не беда, а штатная плановая замена; тревожно
              // только если счётчик его заметно перевалил (значит замена не
              // отрабатывает).
              ok={
                !extractor.browser ||
                extractor.browser.extractions <= extractor.browser.maxExtractions
              }
            />
            <Row
              label="Chromium живёт"
              value={extractor.browser ? `${num(extractor.browser.ageMinutes)} мин` : '—'}
            />
          </>
        )}
      </Section>

      {/* У проверки новых серий нет своих цифр — она только рассылает
          уведомления, — но кнопка ей нужна не меньше остальных: чаще всего
          руками дёргают именно её. */}
      <Section title="Уведомления о новых сериях" jobs={['check-episodes']}>
        <Row
          label="Расписание"
          value="каждый день в 6:00 (/etc/cron.d/mediawatch-check-episodes)"
        />
      </Section>

      <p className="text-xs text-gray-400">
        Расписание: индекс аниме — 5:00, индекс кино — 5:20, обложки — 5:40,
        каталог подкастов — 6:20, каталог книг — 6:40, каталог ранобэ — 7:00,
        каталог манги — 7:20, рейтинги — воскресенье 4:00. Кнопка «Запустить» дёргает ту же ручку,
        что и системный крон, и отвечает сразу — исход появится в строках выше,
        когда прогон закончится.
      </p>
    </div>
  );
}

/** Заголовок раздела и, если раздел чем-то управляет, кнопки запуска
 *  справа от него — рядом с теми самыми строками, куда придёт результат. */
function Section({
  title,
  jobs,
  extra,
  children,
}: {
  title: string;
  jobs?: JobName[];
  /** Кнопка раздела, не связанная с кронами (перезапуск Chromium). */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">{title}</h2>
        {(extra || (jobs && jobs.length > 0)) && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {jobs?.map((job) => (
              <RunJobButton key={job} job={job} />
            ))}
            {extra}
          </div>
        )}
      </div>
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
