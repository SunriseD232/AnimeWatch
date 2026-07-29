import type { ExtractParams, ExtractSource, ResolvedStream } from './types';

/**
 * Извлечение через отдельный VPS-сервис (vps-extractor/, см. его README.md
 * и §12.6 ARCHITECTURE.md) — единственная конфигурация, которая
 * подтверждённо проходила антибот источников за всё расследование: обычный
 * Puppeteer вне serverless-песочницы Vercel + RU-прокси. Сам VPS не хранит
 * ничего, кэш остаётся здесь же (resolved_streams, см. resolve.ts).
 */
export async function extractViaVps(
  source: ExtractSource,
  { shikimoriId, season, episode }: ExtractParams,
): Promise<ResolvedStream | null> {
  const baseUrl = process.env.VPS_EXTRACTOR_URL;
  const token = process.env.VPS_EXTRACTOR_TOKEN;
  if (!baseUrl || !token) {
    console.error('[vpsExtractor] VPS_EXTRACTOR_URL/VPS_EXTRACTOR_TOKEN не заданы в окружении');
    return null;
  }

  let res: Response;
  try {
    res = await fetch(new URL('/extract', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ source, shikimoriId, season, episode }),
      // Puppeteer на VPS может перебирать несколько эмбед-кандидатов подряд —
      // даём запас (сама функция /api/proxy тоже ограничена maxDuration).
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    console.error('[vpsExtractor] fetch к VPS упал:', err);
    return null;
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`[vpsExtractor] VPS вернул ${res.status}:`, await res.text().catch(() => ''));
    return null;
  }

  const data = (await res.json().catch(() => null)) as ResolvedStream | null;
  if (!data?.url) return null;
  return data;
}
