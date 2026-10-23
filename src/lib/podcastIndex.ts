import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import {
  DEFAULT_PODCAST_REGION,
  PODCAST_REGIONS,
  searchPodcastsLive,
  type PodcastRegion,
  type PodcastSummary,
} from '@/lib/podcasts';

/**
 * Построение локального индекса каталога подкастов (см. миграцию 0052).
 *
 * Источник — iTunes Search API по регионам. Каталог у нас лёгкий: id, название,
 * автор, обложка, жанр, регион, язык. Эпизоды и аудио сюда НЕ попадают — они
 * читаются из RSS на лету (lib/podcasts.ts).
 *
 * Приём с партиями тот же, что в animeIndex.ts: строки пишутся со своим
 * batch_id, указатель переключается только после того, как партия собрана
 * целиком. Читатели в любой момент видят целую партию.
 *
 * ЗАЧЕМ ИНДЕКС, ЕСЛИ ЕСТЬ ЖИВОЙ ПОИСК ITUNES. Во-первых, поиск по своей
 * таблице — один индексированный триграммный SQL-запрос вместо десятка
 * сетевых вызовов к Apple (по региону на каждый). Во-вторых, вкладка
 * «Каталог» не пустует: живому поиску нужен запрос, а показать популярное по
 * регионам без запроса он не умеет. Живой поиск при этом остаётся: свежий
 * подкаст, которого ещё нет в индексе, всё равно находится (см. страницу
 * /podcasts).
 */

/** Сколько подкастов забираем за один запрос к iTunes. 200 — потолок API. */
const PER_REQUEST = 200;

/** Сколько запросов на регион. Раньше = популярнее: берём по 200 за раз,
 *  с запасом на дедуп между регионами. */
const REQUESTS_PER_REGION = 3;

/** Базовые поисковые слова. Пустой term iTunes не принимает, а просто
 *  «podcast» даёт шум; эти термины покрывают массовые категории. Набор
 *  намеренно общий: цель — собрать основу каталога, а не точную выдачу. */
const SEED_TERMS = ['podcast', 'news', 'business', 'comedy'];

/** Пауза между запросами. iTunes лимитит ~20 запросов в минуту на IP.
 *  Регионов 19 × слова 4 — это 76 запросов в идеале, поэтому интервал
 *  держим заметным: партия неспешная, ночная. */
const REQUEST_INTERVAL_MS = 3_500;

/** Предохранитель от бесконечного цикла. */
const MAX_ITEMS = 40_000;

/** Партия меньше этого — точно обрыв, а не «каталог усох». Указатель при
 *  сильной усадке не трогаем. */
const MIN_SANE_TITLES = 500;
const MAX_SHRINK_RATIO = 0.8;

const INSERT_CHUNK = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface IndexRow {
  batch_id: string;
  collection_id: number;
  title: string;
  author: string | null;
  description: string | null;
  artwork_original: string | null;
  genre: string | null;
  country: string | null;
  language: string | null;
  episode_count: number | null;
  rank: number | null;
  released_at: string | null;
}

export interface PodcastReindexResult {
  titles: number;
  regions: number;
  requests: number;
  durationMs: number;
  batchId: string;
}

/**
 * Полная перестройка индекса. Возвращает статистику или бросает — вызывающий
 * (крон-роут) пишет исход в podcast_index_state.
 */
export async function rebuildPodcastIndex(): Promise<PodcastReindexResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const batchId = randomUUID();

  await supabase
    .from('podcast_index_state')
    .update({ last_run_started_at: new Date().toISOString(), last_error: null })
    .eq('id', true);

  // ── Уборка за прошлыми неудачами ──
  // Активную партию не трогаем (её прямо сейчас читает каталог), всё
  // остальное — мусор от оборвавшихся попыток (см. тот же приём в
  // animeIndex.ts).
  const { data: before } = await supabase
    .from('podcast_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  if (before?.active_batch) {
    const { error } = await supabase
      .from('podcast_index')
      .delete()
      .neq('batch_id', before.active_batch);
    if (error) console.error('[podcastIndex] уборка старых партий не удалась:', error.message);
  } else {
    const { error } = await supabase.from('podcast_index').delete().not('batch_id', 'is', null);
    if (error) console.error('[podcastIndex] уборка перед первой сборкой не удалась:', error.message);
  }

  // ── Сбор по регионам ──
  // seen — по collection_id: одно шоу всплывает в нескольких регионах и в
  // нескольких поисковых словах. Первое (выше rank) и выигрывает.
  const seen = new Map<number, IndexRow>();
  let requests = 0;

  for (const region of PODCAST_REGIONS) {
    for (const term of SEED_TERMS) {
      if (seen.size >= MAX_ITEMS) break;

      let items: PodcastSummary[] = [];
      try {
        items = await searchPodcastsLive(term, [region.code as PodcastRegion], PER_REQUEST);
      } catch (err) {
        console.error(
          `[podcastIndex] ${region.code}/${term} не удалось:`,
          err instanceof Error ? err.message : err,
        );
      }
      requests++;

      items.forEach((item, i) => {
        if (seen.size >= MAX_ITEMS) return;
        if (seen.has(item.id)) return;
        seen.set(item.id, {
          batch_id: batchId,
          collection_id: item.id,
          title: item.title,
          author: item.author || null,
          // Описание в каталог не тянем: у 200 подкастов на запрос это
          // раздуло бы таблицу в разы, а в поиске оно не участвует.
          description: null,
          artwork_original: item.artworkUrl,
          genre: item.genre,
          country: item.country ?? region.code,
          language: item.language,
          episode_count: item.episodeCount,
          rank: i + 1,
          released_at: null,
        });
      });

      await sleep(REQUEST_INTERVAL_MS);
    }
    if (seen.size >= MAX_ITEMS) break;
  }

  const rows = [...seen.values()];
  const titles = rows.length;

  // ── Проверка на вменяемость ──
  const { data: state } = await supabase
    .from('podcast_index_state')
    .select('titles_count, active_batch')
    .eq('id', true)
    .maybeSingle();

  const previous = state?.titles_count ?? 0;
  const shrunk = previous > 0 && titles < previous * MAX_SHRINK_RATIO;

  if (titles < MIN_SANE_TITLES || shrunk) {
    await discardBatch(supabase, batchId);
    throw new Error(
      `партия подозрительно мала: ${titles} (было ${previous}) — указатель не меняю`,
    );
  }

  // ── Вставка и переключение ──
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from('podcast_index').insert(chunk);
    if (error) {
      await discardBatch(supabase, batchId);
      throw new Error(`вставка партии упала на строке ${i}: ${error.message}`);
    }
  }

  const previousBatch = state?.active_batch ?? null;

  const { error: switchError } = await supabase
    .from('podcast_index_state')
    .update({
      active_batch: batchId,
      built_at: new Date().toISOString(),
      titles_count: titles,
      last_run_finished_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', true);

  if (switchError) {
    await discardBatch(supabase, batchId);
    throw new Error(`не переключил активную партию: ${switchError.message}`);
  }

  // Прошлую партию убираем после успешного переключения — до этого она была
  // страховкой.
  if (previousBatch) {
    const { error } = await supabase
      .from('podcast_index')
      .delete()
      .eq('batch_id', previousBatch);
    if (error) console.error('[podcastIndex] старая партия не удалилась:', error.message);
  }

  return {
    titles,
    regions: PODCAST_REGIONS.length,
    requests,
    durationMs: Date.now() - startedAt,
    batchId,
  };
}

/** Удаление провалившейся партии. Ошибку глотаем: она вторична по отношению
 *  к исходной, из-за которой партию и выбрасываем. */
async function discardBatch(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<void> {
  const { error } = await supabase.from('podcast_index').delete().eq('batch_id', batchId);
  if (error) console.error('[podcastIndex] мусорную партию удалить не удалось:', error.message);
}

/** Регион по умолчанию для крона — экспорт ради читаемости вызывающего кода. */
export const PODCAST_INDEX_DEFAULT_REGION = DEFAULT_PODCAST_REGION;
