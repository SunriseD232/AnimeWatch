import { createClient } from '@/lib/supabase/server';
import { getYummyEpisode } from '@/lib/video/yummy';

/**
 * Подсказка «эта часть есть у источников под другим тайтлом».
 *
 * ЗАЧЕМ. Shikimori режет длинные франшизы (почти всегда — китайские
 * донхуа) на отдельные записи по аркам: «Сводники духов» это 16 тайтлов по
 * 8–26 серий. Источники же держат франшизу ОДНИМ тайтлом со сквозной
 * нумерацией: у Kodik под shikimori_id 31499 лежит 157 серий подряд. В
 * итоге по своему id арка не находится нигде, хотя серии есть — см.
 * shikimori 48694 «Два цветка»: Kodik 0, Yummy пусто, AniLibria пусто, а
 * серии этой арки почти наверняка внутри тех самых 157.
 *
 * ПОЧЕМУ ССЫЛКА, А НЕ ПОДМЕНА ИСТОЧНИКА. Точное смещение вычислить нельзя:
 * порядок и состав арок у источника свои, спецвыпуски и фильмы считаются
 * то так, то этак, проверить сопоставление автоматически нечем. Подставить
 * «серию 135» молча — значит рискнуть показать не ту серию и записать чужой
 * прогресс. Поэтому мы НИЧЕГО не подменяем: считаем вероятный диапазон,
 * говорим о нём вслух и даём ссылку на обычную страницу того тайтла, где
 * дальше работает всё как всегда — сетка серий, плеер, прогресс. Ошиблись
 * на серию-другую — видно сразу, и поправляется одним кликом.
 *
 * ЦЕНА. Считается ТОЛЬКО когда у тайтла не нашлось ни одного источника,
 * то есть на странице, которая и так показывает «источник недоступен». На
 * нормальном пути просмотра не выполняется ни одной лишней строки.
 */

export interface FranchiseFallback {
  /** Тайтл, под которым источники держат франшизу. */
  hostId: number;
  hostTitle: string;
  /** Сквозной номер нашей первой серии у этого тайтла. */
  firstEpisode: number;
  /** ...и последней. Показываем диапазон: промах в одну серию виден сразу. */
  lastEpisode: number;
  /** Сколько серий у тайтла-хозяина всего — видно, что диапазон помещается. */
  hostEpisodes: number;
}

const SHIKIMORI_FRANCHISE = 'https://shikimori.io/api/animes';
/** Франшиза меняется раз в годы — сутки кэша с запасом. */
const FRANCHISE_TTL_S = 86_400;
const FRANCHISE_TIMEOUT_MS = 8_000;

/** Больше — это уже не франшиза, а склейка половины каталога: не считаем. */
const MAX_NODES = 60;

interface FranchiseNode {
  id: number;
}

interface IndexRow {
  shikimori_id: number;
  russian: string | null;
  name: string | null;
  kind: string | null;
  episodes: number | null;
  episodes_aired: number | null;
  aired_on: string | null;
}

async function fetchFranchiseNodes(shikimoriId: number): Promise<number[]> {
  try {
    const res = await fetch(`${SHIKIMORI_FRANCHISE}/${shikimoriId}/franchise`, {
      headers: { 'User-Agent': 'MediaWatch MVP', Accept: 'application/json' },
      next: { revalidate: FRANCHISE_TTL_S },
      signal: AbortSignal.timeout(FRANCHISE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { nodes?: FranchiseNode[] };
    return (data.nodes ?? [])
      .map((n) => Number(n.id))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    // Подсказка необязательная: не ответил Shikimori — просто не будет её.
    return [];
  }
}

/** Сколько серий у записи. Ноль = «неизвестно», такие в счёт не идут. */
function episodeCount(row: IndexRow): number {
  return row.episodes && row.episodes > 0 ? row.episodes : (row.episodes_aired ?? 0);
}

export async function findFranchiseFallback(
  shikimoriId: number,
  episode: number,
): Promise<FranchiseFallback | null> {
  const ids = await fetchFranchiseNodes(shikimoriId);
  if (ids.length < 2 || ids.length > MAX_NODES) return null;

  // Метаданные берём из своего индекса, а не у Shikimori по одному запросу
  // на арку: они там уже лежат (число серий, дата выхода, тип), и это один
  // локальный запрос вместо шестнадцати внешних.
  let rows: IndexRow[] = [];
  try {
    const supabase = createClient();
    const { data: state } = await supabase
      .from('anime_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    const batch = state?.active_batch as string | undefined;
    if (!batch) return null;

    const { data, error } = await supabase
      .from('anime_index')
      .select('shikimori_id, russian, name, kind, episodes, episodes_aired, aired_on')
      .eq('batch_id', batch)
      .in('shikimori_id', ids);
    if (error || !data) return null;
    rows = data as IndexRow[];
  } catch {
    return null;
  }

  const self = rows.find((r) => r.shikimori_id === shikimoriId);
  if (!self) return null;

  // Считаем только записи ТОГО ЖЕ типа: фильмы и спецвыпуски у источников в
  // сквозную нумерацию сериала обычно не попадают, а если попадают — промах
  // будет на одну-две серии, что и видно по показанному диапазону.
  const sameKind = rows.filter((r) => r.kind === self.kind && episodeCount(r) > 0);
  if (sameKind.length < 2) return null;

  const ordered = [...sameKind].sort((a, b) => {
    const byDate = (a.aired_on ?? '9999').localeCompare(b.aired_on ?? '9999');
    return byDate !== 0 ? byDate : a.shikimori_id - b.shikimori_id;
  });

  let offset = 0;
  let found = false;
  for (const row of ordered) {
    if (row.shikimori_id === shikimoriId) {
      found = true;
      break;
    }
    offset += episodeCount(row);
  }
  if (!found || offset === 0) return null; // первая арка — её и так ищут по своему id

  const firstEpisode = offset + 1;
  const lastEpisode = offset + episodeCount(self);
  const wanted = offset + Math.max(1, episode);

  // Кого спрашивать. Искать «запись, у которой по Shikimori серий хватает
  // на наш диапазон» бессмысленно: у Shikimori КАЖДАЯ арка короткая, 157
  // серий подряд — это цифра источника, а не его. Источники же вешают весь
  // сквозной прогон на САМУЮ РАННЮЮ запись франшизы. Поэтому идём по дате
  // выхода и спрашиваем сам источник.
  //
  // Не больше трёх попыток: страница отсутствующего тайтла не должна
  // превращаться в обход всей франшизы.
  const candidates = ordered.filter((r) => r.shikimori_id !== shikimoriId).slice(0, 3);

  for (const host of candidates) {
    // Проверяем не «есть ли у хозяина источники вообще», а есть ли у него
    // ИМЕННО ЭТА серия: подсказка ведёт на конкретный номер, и звать туда,
    // где его нет, — то же самое, что не звать вовсе.
    const yummy = await getYummyEpisode(host.shikimori_id, wanted);
    if (!yummy || yummy.translations.length === 0) continue;

    return {
      hostId: host.shikimori_id,
      hostTitle: host.russian ?? host.name ?? 'та же франшиза',
      firstEpisode,
      lastEpisode,
      hostEpisodes: yummy.episodesTotal,
    };
  }

  return null;
}
