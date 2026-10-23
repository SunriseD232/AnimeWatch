import Link from 'next/link';
import { decodeSegment } from '@/lib/routeParams';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import RanobeReader from '@/components/ranobe/RanobeReader';
import { getRanobeChapterById, getRanobeDetails, listRanobeChapters } from '@/lib/ranobe';
import { ranobeTitleHref } from '@/lib/ranobeShared';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { dir: string; chapterId: string };
}): Promise<Metadata> {
  const details = await getRanobeDetails(decodeSegment(params.dir));
  if (!details) return { title: 'Ранобэ — MediaWatch' };
  return { title: `${details.title} — читать — MediaWatch` };
}

/**
 * Читатель ранобэ: /ranobe/read/[dir]/[chapterId].
 *
 * Здесь собирается всё, что нужно клиентскому RanobeReader: карточка тайтла,
 * полное оглавление и текст одной главы. Текст приходит с API Renovels,
 * очищается sanitize-html в lib/ranobe.ts и в базу не пишется (см. миграцию
 * 0055). Если API не ответил, страница честно говорит «глава недоступна», а
 * не отдаёт пустой экран.
 *
 * Позиция восстанавливается из watch_progress по id тайтла. Берём
 * locator.scrollPercent только если сохранённая глава совпадает с открытой:
 * иначе при переходе «вперёд» новая глава открылась бы на середине.
 */
export default async function RanobeReaderPage({
  params,
}: {
  params: { dir: string; chapterId: string };
}) {
  const chapterId = Number(params.chapterId);
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) notFound();

  const details = await getRanobeDetails(decodeSegment(params.dir));
  if (!details) notFound();

  const [chapters, chapter] = await Promise.all([
    details.branchId
      ? listRanobeChapters(details.branchId)
      : Promise.resolve([]),
    getRanobeChapterById(chapterId),
  ]);

  if (!chapter) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-xl font-bold">Глава недоступна</h1>
        <p className="text-sm text-gray-400">
          Renovels не отдал текст этой главы. Возможно, она удалена, перенесена или источник
          временно не отвечает.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={ranobeTitleHref(details.dir)}
            className="press rounded-full bg-bg-card px-4 py-2 text-sm ring-1 ring-white/10 hover:text-white"
          >
            ← К оглавлению
          </Link>
          <Link
            href="/ranobe"
            className="press rounded-full bg-bg-card px-4 py-2 text-sm ring-1 ring-white/10 hover:text-white"
          >
            Все ранобэ
          </Link>
        </div>
      </div>
    );
  }

  // API вернул главу другого тайтла — значит, ссылка собрана неверно. Честнее
  // 404, чем показать текст чужой книги под чужим названием.
  if (chapter.titleId > 0 && chapter.titleId !== details.id) notFound();

  const tocChapter = chapters.find((c) => c.id === chapter.id);
  const chapterIndex =
    tocChapter?.index && tocChapter.index > 0
      ? tocChapter.index
      : chapter.index > 0
        ? chapter.index
        : 1;
  const chaptersCount =
    details.chaptersCount && details.chaptersCount > 0
      ? details.chaptersCount
      : chapters.length || 1;

  let savedChapterId: number | null = null;
  let initialScrollPercent = 0;

  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (user) {
    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'ranobe')
      .eq('shikimori_id', details.id)
      .maybeSingle();

    const progress = (data as WatchProgress | null) ?? null;
    const locator =
      progress?.locator && typeof progress.locator === 'object'
        ? progress.locator
        : null;

    savedChapterId =
      locator && Number.isFinite(Number(locator.chapterId))
        ? Number(locator.chapterId)
        : null;

    // Если сохранена другая глава — начинаем эту с начала. Если та же —
    // возвращаемся на место внутри неё.
    if (savedChapterId === chapter.id) {
      const scroll = Number(locator?.scrollPercent);
      initialScrollPercent = Number.isFinite(scroll)
        ? Math.max(0, Math.min(1, scroll))
        : 0;
    }
  }

  const cover = details.coverUrl
    ? `${details.coverUrl}${details.coverUrl.includes('?') ? '&' : '?'}w=240`
    : null;

  return (
    <RanobeReader
      key={chapter.id}
      titleId={details.id}
      dir={details.dir}
      title={details.title}
      coverUrl={cover}
      chapter={chapter}
      chapterIndex={chapterIndex}
      chapters={chapters}
      chaptersCount={chaptersCount}
      initialScrollPercent={initialScrollPercent}
    />
  );
}
