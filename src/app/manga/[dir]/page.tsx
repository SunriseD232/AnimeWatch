import Link from 'next/link';
import { decodeSegment } from '@/lib/routeParams';
import ListButton from '@/components/ListButton';
import { getListEntry } from '@/lib/listEntry';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import PosterImage from '@/components/PosterImage';
import CanonicalBootstrap from '@/components/sources/CanonicalBootstrap';
import { getMangaDetails, listMangaChapters } from '@/lib/manga';
import {
  mangaReadHref,
  mangaSourceLabel,
  type MangaChapter,
} from '@/lib/mangaShared';
import { canonicalToMangaChapters } from '@/lib/sources/mangaView';
import {
  getStoredCanonicalChapters,
  getStoredTitleSources,
} from '@/lib/sources/resolve';
import type { SourceTitleKey } from '@/lib/sources/types';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { dir: string };
}): Promise<Metadata> {
  const details = await getMangaDetails(decodeSegment(params.dir));
  if (!details) return { title: 'Манга — MediaWatch' };
  return {
    title: `${details.title} — манга — MediaWatch`,
    description: details.description?.slice(0, 200) ?? undefined,
  };
}

/**
 * Карточка манги.
 *
 * Remanga отдаёт тайтл по слагу `dir`, поэтому адрес — /manga/[dir], а не
 * /manga/[id]. Метаданные и оглавление берутся живьём; запись в manga_index
 * нужна как запасной вариант, если API источника недоступен (тогда страница
 * показывает хотя бы название и обложку).
 *
 * Платные главы видны в оглавлении, но не кликабельны: страницы физически не
 * приходят от источника без покупки, и делать вид, что мы их обошли, нельзя.
 */
export default async function MangaTitlePage({
  params,
}: {
  params: { dir: string };
}) {
  const details = await getMangaDetails(decodeSegment(params.dir));
  if (!details) notFound();

  const supabase = createClient();

  const titleKey: SourceTitleKey = {
    contentType: 'manga',
    titleKey: details.id,
    title: details.title,
    altTitles: [details.originalTitle, details.alternativeTitle].filter(
      (value): value is string =>
        typeof value === 'string' && value.length > 0,
    ),
    year: details.year ?? undefined,
  };

  // Каноническое оглавление читаем ТОЛЬКО из БД: писать в server render
  // нельзя. Если его ещё нет — показываем Remanga и запускаем bootstrap.
  const [{ data: { user } }, legacyChapters, storedCanonical, storedSources] =
    await Promise.all([
      getCachedUser(),
      details.branchId
        ? listMangaChapters(details.branchId, details.chaptersCount ?? 0)
        : Promise.resolve<MangaChapter[]>([]),
      getStoredCanonicalChapters(titleKey),
      getStoredTitleSources(titleKey),
    ]);

  const canonicalMode = storedCanonical.length > 0;
  const chapters = canonicalMode
    ? canonicalToMangaChapters(storedCanonical)
    : legacyChapters;

  // Если источник появился позже (например, включили MangaLib), канонические
  // главы его ещё не содержат. Просим bootstrap пересобрать.
  const canonicalSources = new Set(
    storedCanonical.flatMap((chapter) =>
      chapter.sources.map((source) => source.source),
    ),
  );
  const hasNewSources = storedSources.some(
    (source) => !canonicalSources.has(source.source),
  );
  const needsBootstrap = !canonicalMode || hasNewSources;
  const bootstrapRefresh = canonicalMode && hasNewSources;

  let progress: WatchProgress | null = null;
  let listEntry: Awaited<ReturnType<typeof getListEntry>> = null;
  if (user) {
    const [{ data }, entry] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'manga')
        .eq('shikimori_id', details.id)
        .maybeSingle(),
      getListEntry('manga', details.id),
    ]);
    progress = (data as WatchProgress | null) ?? null;
    listEntry = entry;
  }

  const locator =
    progress?.locator && typeof progress.locator === 'object'
      ? progress.locator
      : null;
  // Сначала пробуем найти главу по устойчивым координатам (номер + том):
  // idx может сдвинуться, если в середину добавили новую главу. Если номера
  // нет (старая запись) — откатываемся на idx/chapterId.
  const savedNo = locator ? Number(locator.chapterNo) : NaN;
  const savedTome = locator ? Number(locator.tome) : NaN;
  const savedByNumber =
    canonicalMode && Number.isFinite(savedNo)
      ? (storedCanonical.find(
          (chapter) =>
            chapter.chapterNo === savedNo &&
            // Пустой том = первый с обеих сторон: читатель сохраняет
            // tome ?? 1 (см. mangaView.ts), сравнение с 0 не совпало бы.
            (chapter.tome ?? 1) ===
              (Number.isFinite(savedTome) && savedTome > 0 ? savedTome : 1),
        )?.idx ?? null)
      : null;

  const savedChapterKey =
    savedByNumber ??
    (locator && Number.isFinite(Number(locator.idx))
      ? Number(locator.idx)
      : locator && Number.isFinite(Number(locator.chapterId))
        ? Number(locator.chapterId)
        : null);
  const savedChapterLabel =
    locator && typeof locator.chapterLabel === 'string'
      ? locator.chapterLabel
      : progress
        ? `Глава ${progress.episode}`
        : null;

  // Первая читаемая глава, а не просто первая: у источника бывает платный
  // пролог, и кнопка «начать» не должна вести в тупик.
  const firstReadable = chapters.find((c) => c.isReadable) ?? null;
  const firstChapterKey =
    firstReadable?.id ?? details.firstChapterId ?? chapters[0]?.id ?? null;

  // Если источник отдал оглавление, но все главы платные, кнопка «читать»
  // вела бы прямо в заглушку. Честнее сказать это на карточке; сами главы
  // остаются видны в списке с пометкой «платно».
  const allPaid = chapters.length > 0 && !firstReadable;

  const resumeChapterKey = savedChapterKey ?? firstChapterKey;
  const readHref =
    !allPaid && resumeChapterKey != null && details.dir
      ? mangaReadHref(details.dir, resumeChapterKey)
      : null;

  const percent =
    progress?.progress_percent != null
      ? Math.round(Math.max(0, Math.min(1, progress.progress_percent)) * 100)
      : null;

  const chaptersCount =
    details.chaptersCount && details.chaptersCount > 0
      ? details.chaptersCount
      : chapters.length;

  const cover = details.coverUrl
    ? `${details.coverUrl}${details.coverUrl.includes('?') ? '&' : '?'}w=480`
    : null;

  const meta = [
    details.kind,
    details.status,
    details.year ? String(details.year) : null,
    details.rating != null && details.rating > 0
      ? `★ ${details.rating.toFixed(1)}`
      : null,
    chaptersCount > 0 ? `${chaptersCount} гл.` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <Link href="/manga" className="w-fit text-sm text-gray-400 transition hover:text-white">
        ← Вся манга
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="mx-auto aspect-[2/3] w-44 shrink-0 overflow-hidden rounded-2xl bg-bg-soft ring-1 ring-inset ring-white/5 sm:mx-0 sm:w-52">
          {cover ? (
            <PosterImage
              sources={[cover]}
              alt={details.title}
              priority
              className="h-full w-full object-cover"
              placeholderClassName="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card p-4 text-center text-sm text-gray-400"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card">
              <span className="text-5xl font-bold text-white/15">
                {details.title.trim().charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold leading-tight">{details.title}</h1>
            {details.originalTitle ? (
              <p className="text-sm text-gray-400">{details.originalTitle}</p>
            ) : null}
            <p className="text-sm text-gray-400">{meta}</p>
          </div>

          {details.genres.length > 0 || details.categories.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...details.genres, ...details.categories]))
                .slice(0, 10)
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-bg-soft px-2.5 py-1 text-xs text-gray-300 ring-1 ring-white/10"
                  >
                    {tag}
                  </span>
                ))}
            </div>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {readHref ? (
              <Link
                href={readHref}
                prefetch={false}
                className="press rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
              >
                {savedChapterKey != null
                  ? `Продолжить${percent != null ? ` · ${percent}%` : ''}`
                  : 'Начать читать'}
              </Link>
            ) : (
              <span className="rounded-full bg-bg-soft px-5 py-2.5 text-sm text-gray-500 ring-1 ring-white/10">
                {allPaid ? 'Все главы платные' : 'Глав пока нет'}
              </span>
            )}

            {savedChapterKey != null && savedChapterLabel ? (
              <span className="rounded-full bg-bg-card px-3 py-2 text-xs text-gray-400 ring-1 ring-white/10">
                {savedChapterLabel}
              </span>
            ) : null}

            <ListButton
              shikimoriId={details.id}
              contentType="manga"
              animeTitle={details.title}
              posterUrl={details.coverUrl}
              initialStatus={listEntry?.status ?? null}
              initialMuted={listEntry?.muted ?? false}
              isAuthed={!!user}
            />

            {details.sourceUrl ? (
              <a
                href={details.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="press rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 hover:text-white"
              >
                Источник: {mangaSourceLabel()}
              </a>
            ) : null}
          </div>

          {percent != null ? (
            <span
              aria-hidden="true"
              className="block h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-bg-soft"
            >
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${percent}%` }}
              />
            </span>
          ) : null}

          <p className="text-xs text-gray-500">
            Чтение — прямо на сайте, место сохраняется автоматически. Платные
            главы источника отмечены в оглавлении; их страницы недоступны без
            покупки.
          </p>

          {needsBootstrap ? (
            <CanonicalBootstrap
              contentType="manga"
              titleKey={details.id}
              dir={details.dir}
              title={details.title}
              altTitles={titleKey.altTitles ?? []}
              year={details.year ?? undefined}
              refresh={bootstrapRefresh}
            />
          ) : null}

          {!user ? (
            <p className="text-xs text-gray-500">
              Войдите, чтобы позиция чтения сохранялась между устройствами.
            </p>
          ) : null}
        </div>
      </div>

      {!details.sourceAvailable ? (
        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          Источник сейчас не отвечает: показаны сохранённые метаданные.
          Оглавление и чтение станут доступны, когда Remanga снова ответит.
        </p>
      ) : null}

      {details.description ? (
        <section className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">
            {details.description}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Оглавление</h2>
          <span className="text-xs text-gray-500">
            {chaptersCount > 0 ? `${chaptersCount} глав` : 'Список пуст'}
          </span>
        </div>

        {!details.sourceAvailable ? (
          <p className="rounded-2xl border border-white/5 bg-bg-card p-4 text-sm text-gray-400">
            Оглавление загрузится, когда источник ответит.
          </p>
        ) : chapters.length === 0 ? (
          <p className="rounded-2xl border border-white/5 bg-bg-card p-4 text-sm text-gray-400">
            У этого тайтла пока нет опубликованных глав.
          </p>
        ) : (
          <ol className="max-h-[38rem] overflow-y-auto rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5">
            {chapters.map((chapter, i) => {
              const previousTome = i > 0 ? chapters[i - 1].tome : null;
              const current = chapter.id === savedChapterKey;
              return (
                <li key={chapter.id} className="border-b border-white/5 last:border-b-0">
                  {chapter.tome > 1 && chapter.tome !== previousTome ? (
                    <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Том {chapter.tome}
                    </p>
                  ) : null}

                  {!chapter.isReadable ? (
                    <span
                      aria-disabled="true"
                      title="Платная глава: страницы недоступны без покупки у источника"
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-gray-500"
                    >
                      <span className="min-w-0 truncate">{chapter.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {chapter.sourceLabels?.length ? (
                          <span className="text-[10px] uppercase tracking-wide text-gray-500">
                            {chapter.sourceLabels.join(' · ')}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                          платно
                        </span>
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={mangaReadHref(details.dir, chapter.id)}
                      prefetch={false}
                      aria-current={current ? 'page' : undefined}
                      className={[
                        'flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition',
                        current
                          ? 'bg-accent/10 font-semibold text-accent-text'
                          : 'text-gray-300 hover:bg-bg-soft hover:text-white',
                      ].join(' ')}
                    >
                      <span className="min-w-0 truncate">{chapter.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {chapter.sourceLabels?.length ? (
                          <span className="text-[10px] uppercase tracking-wide text-gray-500">
                            {chapter.sourceLabels.join(' · ')}
                          </span>
                        ) : null}
                        {current ? (
                          <span className="text-[10px] uppercase tracking-wide">
                            вы здесь
                          </span>
                        ) : chapter.isFreeToday ? (
                          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                            сегодня бесплатно
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
