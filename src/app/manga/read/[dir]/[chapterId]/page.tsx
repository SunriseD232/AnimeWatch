import Link from 'next/link';
import { decodeSegment } from '@/lib/routeParams';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import MangaReader from '@/components/manga/MangaReader';
import { normalizeReaderSettings, type MangaReaderSettings } from '@/lib/mangaReaderSettings';
import {
  getMangaChapterById,
  getMangaDetails,
  listMangaChapters,
} from '@/lib/manga';
import {
  mangaTitleHref,
  type MangaChapter,
  type MangaChapterContent,
} from '@/lib/mangaShared';
import {
  canonicalChapterContent,
  canonicalToMangaChapters,
} from '@/lib/sources/mangaView';
import {
  findCanonicalIdxBySourceKey,
  getCanonicalChapters,
  getStoredCanonicalChapters,
  resolveChapterContent,
} from '@/lib/sources/resolve';
import {
  MANGALIB_DIR_PREFIX,
  isMangaLibDir,
  mangaLibSiteUrl,
} from '@/lib/sources/mangalib';
import type { SourceId, SourceTitleKey } from '@/lib/sources/types';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SOURCE_IDS = new Set<SourceId>([
  'remanga',
  'mangadex',
  'mangalib',
  'selfmanga',
  'mintmanga',
  'yai',
  'renovels',
  'flibusta',
]);

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asSourceId(value: string | undefined): SourceId | undefined {
  return value && SOURCE_IDS.has(value as SourceId)
    ? (value as SourceId)
    : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: { dir: string; chapterId: string };
}): Promise<Metadata> {
  const details = await getMangaDetails(decodeSegment(params.dir));
  if (!details) return { title: 'Манга — MediaWatch' };
  return { title: `${details.title} — читать — MediaWatch` };
}

/**
 * Читатель манги: /manga/read/[dir]/[key].
 *
 * `key` — канонический idx, если для тайтла уже собрано каноническое
 * оглавление. Иначе — старый id главы Remanga (обратная совместимость ссылок
 * и работы до первого маппинга).
 *
 * Старые ссылки /read/[dir]/[chapterId] после появления канонической оси
 * редиректятся на /read/[dir]/[idx]?source=remanga через chapter_sources.
 */
export default async function MangaReaderPage({
  params,
  searchParams,
}: {
  params: { dir: string; chapterId: string };
  searchParams?: { source?: string | string[] };
}) {
  const segment = Number(params.chapterId);
  if (!Number.isSafeInteger(segment) || segment <= 0) notFound();

  const details = await getMangaDetails(decodeSegment(params.dir));
  if (!details) notFound();

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

  const preferred = asSourceId(firstParam(searchParams?.source));
  const mangaLibOnly = isMangaLibDir(details.dir);
  let canonical = await getStoredCanonicalChapters(titleKey);
  // Тайтл только с MangaLib: оглавления у Remanga нет, старого пути чтения
  // тоже. Если по прямой ссылке зашли раньше, чем карточка собрала
  // оглавление, собираем его здесь (seed — slug_url MangaLib).
  if (mangaLibOnly && canonical.length === 0) {
    const slug = details.dir.slice(MANGALIB_DIR_PREFIX.length);
    try {
      canonical = await getCanonicalChapters(titleKey, {
        seed: {
          source: 'mangalib',
          externalId: slug,
          variant: 'default',
          title: details.title,
          confidence: 1,
          language: 'ru',
          externalUrl: mangaLibSiteUrl(slug),
        },
      });
    } catch {
      canonical = [];
    }
  }
  const canonicalChapter =
    canonical.find((chapter) => chapter.idx === segment) ?? null;

  // Каноническое оглавление есть, но сегмент — старый Remanga chapterId.
  if (canonical.length > 0 && !canonicalChapter) {
    const mappedIdx = await findCanonicalIdxBySourceKey(
      titleKey,
      'remanga',
      String(segment),
    );

    if (mappedIdx != null) {
      const query = preferred ? `?source=${encodeURIComponent(preferred)}` : '';
      redirect(
        `/manga/read/${encodeURIComponent(details.dir)}/${mappedIdx}${query}`,
      );
    }
  }

  const canonicalMode = canonicalChapter != null;

  let chapter: MangaChapterContent | null = null;
  let chapters: MangaChapter[] = [];
  let chapterIndex = 1;
  let chaptersCount = 1;
  let source: SourceId = 'remanga';
  let chapterKey = String(segment);

  if (canonicalMode && canonicalChapter) {
    chapters = canonicalToMangaChapters(canonical);
    chapterIndex = canonicalChapter.idx;
    chaptersCount = canonical.length;

    try {
      const result = await resolveChapterContent(
        titleKey,
        canonicalChapter.idx,
        preferred,
      );

      if (result.ok) {
        source = result.source;
        chapterKey = result.chapterKey;
        chapter = canonicalChapterContent({
          titleId: details.id,
          chapter: canonicalChapter,
          content: result.content,
          paid: false,
        });
      } else {
        chapter = canonicalChapterContent({
          titleId: details.id,
          chapter: canonicalChapter,
          content: null,
          paid: result.reason === 'paid',
        });
      }
    } catch {
      chapter = canonicalChapterContent({
        titleId: details.id,
        chapter: canonicalChapter,
        content: null,
        paid: false,
      });
    }
  } else if (!mangaLibOnly) {
    // Старый путь: главы и страницы напрямую из Remanga.
    const legacyChapters = details.branchId
      ? await listMangaChapters(details.branchId, details.chaptersCount ?? 0)
      : [];
    chapters = legacyChapters;

    const tocChapter =
      legacyChapters.find((entry) => entry.id === segment) ?? null;

    // Бесплатную главу запрашиваем, платную — нет. Если главы нет в
    // оглавлении (например, длиннее лимита пагинации), источник сам скажет,
    // отдаёт ли он страницы.
    chapter =
      tocChapter && !tocChapter.isReadable
        ? contentFromToc(tocChapter, details.id)
        : (await getMangaChapterById(segment)) ??
          (tocChapter ? contentFromToc(tocChapter, details.id) : null);

    if (chapter) {
      // API вернул главу другого тайтла — ссылка собрана неверно.
      if (chapter.titleId > 0 && chapter.titleId !== details.id) notFound();

      chapterIndex =
        tocChapter?.index && tocChapter.index > 0
          ? tocChapter.index
          : chapter.index > 0
            ? chapter.index
            : 1;
      chaptersCount =
        details.chaptersCount && details.chaptersCount > 0
          ? details.chaptersCount
          : legacyChapters.length || 1;
      source = 'remanga';
      chapterKey = String(chapter.id);
    }
  }

  if (!chapter) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-xl font-bold">Глава недоступна</h1>
        <p className="text-sm text-gray-400">
          Источник не отдал страницы этой главы. Возможно, она платная, удалена
          или источник временно не отвечает.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={mangaTitleHref(details.dir)}
            className="press rounded-full bg-bg-card px-4 py-2 text-sm ring-1 ring-white/10 hover:text-white"
          >
            ← К оглавлению
          </Link>
          <Link
            href="/manga"
            className="press rounded-full bg-bg-card px-4 py-2 text-sm ring-1 ring-white/10 hover:text-white"
          >
            Вся манга
          </Link>
        </div>
      </div>
    );
  }

  let savedKey: number | null = null;
  let initialScrollPercent = 0;

  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  let readerSettings: MangaReaderSettings | null = null;

  if (user) {
    // Прогресс и настройки читалки (миграция 0062) — параллельно: это два
    // независимых запроса, и страница главы ждёт оба.
    const [{ data }, { data: profileRow }] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'manga')
        .eq('shikimori_id', details.id)
        .maybeSingle(),
      supabase.from('profiles').select('manga_reader').eq('user_id', user.id).maybeSingle(),
    ]);
    readerSettings = profileRow?.manga_reader
      ? normalizeReaderSettings(profileRow.manga_reader)
      : null;

    const progress = (data as WatchProgress | null) ?? null;
    const locator =
      progress?.locator && typeof progress.locator === 'object'
        ? progress.locator
        : null;

    savedKey = Number.isFinite(Number(locator?.idx))
      ? Number(locator?.idx)
      : Number.isFinite(Number(locator?.chapterId))
        ? Number(locator?.chapterId)
        : null;

    // Устойчивая проверка: номер главы + том важнее idx, который может
    // сдвинуться при вставке новой главы в середину.
    const savedNo = Number(locator?.chapterNo);
    const savedTome = Number(locator?.tome);
    // Том без значения считаем первым с обеих сторон: читатель получает
    // chapter.tome = canonical.tome ?? 1 (см. mangaView.ts) и сохраняет в
    // locator именно 1. Сравнение с 0 никогда не совпало бы у тайтлов без
    // томов, и позиция держалась бы только на idx.
    const sameByNumber =
      canonicalMode &&
      canonicalChapter != null &&
      Number.isFinite(savedNo) &&
      canonicalChapter.chapterNo === savedNo &&
      (canonicalChapter.tome ?? 1) ===
        (Number.isFinite(savedTome) && savedTome > 0 ? savedTome : 1);

    // Если сохранена другая глава — начинаем эту с начала. Если та же —
    // возвращаемся на место внутри неё.
    if (sameByNumber || savedKey === chapter.id) {
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
    <MangaReader
      key={`${source}:${chapterKey}`}
      titleId={details.id}
      dir={details.dir}
      title={details.title}
      coverUrl={cover}
      chapter={chapter}
      chapterIndex={chapterIndex}
      chapters={chapters}
      chaptersCount={chaptersCount}
      initialScrollPercent={initialScrollPercent}
      source={source}
      chapterKey={chapterKey}
      readerSettings={readerSettings}
      signedIn={!!user}
    />
  );
}

/** Запись из оглавления без страниц: для платных и недоступных глав. */
function contentFromToc(
  chapter: MangaChapter,
  titleId: number,
): MangaChapterContent {
  return {
    id: chapter.id,
    titleId,
    index: chapter.index,
    tome: chapter.tome,
    number: chapter.number,
    name: chapter.name,
    isPaid: chapter.isPaid,
    isFreeToday: chapter.isFreeToday,
    pages: [],
    hasPages: false,
  };
}
