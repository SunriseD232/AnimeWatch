/**
 * Состояние VPS-экстрактора для страницы /admin/status.
 *
 * Читается сервером напрямую с его /health (он слушает на 127.0.0.1, наружу
 * не смотрит). Никогда не бросает: экстрактор — отдельный процесс, и если он
 * лежит, страница состояния должна об этом СКАЗАТЬ, а не упасть вместе с ним.
 */
export interface ExtractorHealth {
  reachable: boolean;
  uptimeMinutes: number;
  rssMb: number | null;
  browser: {
    running: boolean;
    extractions: number;
    ageMinutes: number;
    maxExtractions: number;
  } | null;
}

const OFFLINE: ExtractorHealth = {
  reachable: false,
  uptimeMinutes: 0,
  rssMb: null,
  browser: null,
};

export async function getExtractorHealth(): Promise<ExtractorHealth> {
  const baseUrl = process.env.VPS_EXTRACTOR_URL;
  if (!baseUrl) return OFFLINE;

  try {
    const res = await fetch(new URL('/health', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return OFFLINE;
    const data = (await res.json()) as {
      uptime?: number;
      rssMb?: number;
      browser?: ExtractorHealth['browser'];
    };
    return {
      reachable: true,
      uptimeMinutes: Math.round((data.uptime ?? 0) / 60),
      rssMb: typeof data.rssMb === 'number' ? data.rssMb : null,
      browser: data.browser ?? null,
    };
  } catch {
    return OFFLINE;
  }
}
