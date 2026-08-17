import { allohaDispatcher } from '@/lib/net/allohaProxy';

/**
 * Официальный API Alloha (в отличие от анимного пути через Yummy, см.
 * lib/video/yummy.ts, — здесь прямой платный доступ по токену и по
 * kinopoisk_id, работает и для кино). Встраиваем их iframe НАПРЯМУЮ (родной
 * плеер Alloha) — так у пользователя есть их собственный селектор качества,
 * включая 4K (проверено вживую: через наше извлечение — Puppeteer, клик +
 * ожидание — доставался только 480p, ручной переключатель качества внутри
 * их плеера мы не эмулировали). Точный трекинг позиции взамен теряем — как
 * у Videoseed, только оценка по фокусу/паузам, см. useVideoseedEstimator.
 *
 * Гео-заблокирована — без RU-прокси (см. lib/net/allohaProxy.ts) даже сам
 * API-запрос с валидным токеном не проходит.
 *
 * "ONLY FOR PERSONAL USE" — токены создаются самостоятельно, несколько
 * штук про запас (не все могут быть активны сразу), поэтому пробуем по
 * очереди и останавливаемся на первом, который реально отвечает "success".
 */
const ALLOHA_API = 'https://api.alloha.tv/';
const ALLOHA_TIMEOUT_MS = 10_000;

function tokens(): string[] {
  return [process.env.ALLOHA_TOKEN, process.env.ALLOHA_TOKEN_2].filter(
    (t): t is string => !!t,
  );
}

interface AllohaTranslationEntry {
  name?: string;
  iframe?: string;
  uhd?: boolean;
}

interface AllohaResponse {
  status?: string;
  data?: {
    translation_iframe?: Record<string, AllohaTranslationEntry>;
  };
}

async function fetchWithToken(kinopoiskId: number, token: string): Promise<AllohaResponse | null> {
  try {
    const res = await fetch(`${ALLOHA_API}?token=${token}&kp=${kinopoiskId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ALLOHA_TIMEOUT_MS),
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: allohaDispatcher(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AllohaResponse;
    return data.status === 'success' ? data : null;
  } catch {
    return null;
  }
}

/** Пробует токены по очереди, останавливается на первом рабочем. */
async function fetchAlloha(kinopoiskId: number): Promise<AllohaResponse | null> {
  for (const token of tokens()) {
    const data = await fetchWithToken(kinopoiskId, token);
    if (data) return data;
  }
  return null;
}

/**
 * Embed-ссылка на родной плеер Alloha для фильма по kinopoisk_id, либо
 * null (нет тайтла у Alloha / токены не заданы / не сработали). Выбор
 * озвучки среди списка translation_iframe: сперва дублированная (самый
 * привычный вариант для большинства зрителей), иначе любая с флагом uhd,
 * иначе первая доступная.
 */
export async function getAllohaEmbedUrl(kinopoiskId: number): Promise<string | null> {
  if (tokens().length === 0) return null;
  const data = await fetchAlloha(kinopoiskId);
  const entries = Object.values(data?.data?.translation_iframe ?? {}).filter(
    (t): t is AllohaTranslationEntry & { iframe: string } => !!t.iframe,
  );
  if (entries.length === 0) return null;

  const dubbed = entries.find((t) => (t.name ?? '').toLowerCase().includes('дублир'));
  const uhd = entries.find((t) => t.uhd);
  return (dubbed ?? uhd ?? entries[0]).iframe;
}
