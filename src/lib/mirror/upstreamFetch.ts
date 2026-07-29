import path from 'node:path';
import fs from 'node:fs';
import initCycleTLS, { type CycleTLSClient } from 'cycletls';
import { getAllohaProxyUrl } from './proxyBridge';

/**
 * TLS/JA3-имперсонация настоящего Chrome для серверного relay-хопа к
 * источникам — см. §12.6 ARCHITECTURE.md. Обычный fetch/undici оба
 * источника (Alloha /bnsi/, Videoseed /embed_auto/) рвут на TLS-уровне —
 * подтверждено ЛОКАЛЬНО и на Vercel одинаково, значит дело в отпечатке
 * TLS-клиента, а не в IP/гео (RU-прокси не помогал).
 *
 * ⚠️ Первая попытка — `node-wreq` (нативный N-API/Rust-биндинг) — TLS-
 * фингерпринт подделывала верно и локально решала обе проблемы, но на
 * самом Vercel её fetch() подключался к НАШЕМУ ЖЕ приложению вместо
 * реального апстрима (см. git history "Revert node-wreq") — похоже на
 * несовместимость нативного Rust-сетевого стека с сетевым namespace
 * serverless-песочницы Vercel. CycleTLS устроена иначе: не in-process
 * биндинг, а ОТДЕЛЬНЫЙ Go-процесс, с которым JS общается по локальному
 * порту (тот же паттерн, что уже подтверждённо работает у нас в
 * proxyBridge.ts — proxy-chain делает ровно так же) — есть шанс, что
 * именно этот паттерн совместим с песочницей там, где in-process биндинг
 * не сработал.
 */

const CHROME_JA3 =
  '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Пакет содержит бинарники под 7 платформ разом (~130 МБ распакованные,
 * см. §12.6 ARCHITECTURE.md) — грузится не через require(), а через
 * fs.existsSync()+child_process.spawn(), трейсер файлов Vercel (nft) это
 * не видит вообще (см. next.config.js: форсируем только linux-x64 через
 * outputFileTracingIncludes). Права на выполнение при копировании файла в
 * бандл могут не сохраниться — выставляем явно.
 */
function resolveLinuxExecutablePath(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  const execPath = path.join(process.cwd(), 'node_modules/cycletls/dist/index');
  try {
    if (!fs.existsSync(execPath)) return undefined;
    fs.chmodSync(execPath, 0o755);
    return execPath;
  } catch {
    return undefined;
  }
}

/** Один процесс на тёплый инстанс функции — не поднимаем Go-процесс на каждый запрос. */
let clientPromise: Promise<CycleTLSClient> | null = null;

function getClient(): Promise<CycleTLSClient> {
  if (clientPromise) return clientPromise;
  clientPromise = initCycleTLS({ executablePath: resolveLinuxExecutablePath() });
  return clientPromise;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Прокидывает запрос апстриму — через RU-прокси, если задан в окружении
 * (см. .env.example, ALLOHA_PROXY_*) И источник его запрашивает
 * (`useProxy` в src/lib/mirror/sources.ts), иначе напрямую.
 */
export async function fetchUpstream(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | null;
    useProxy?: boolean;
  } = {},
): Promise<UpstreamResponse> {
  const client = await getClient();
  const proxy = init.useProxy ? getAllohaProxyUrl() : undefined;

  const method = (init.method ?? 'GET').toLowerCase() as
    | 'get'
    | 'post'
    | 'head'
    | 'put'
    | 'delete'
    | 'patch';

  const res = await client(
    url,
    {
      headers: init.headers,
      // POST-тело у наших источников — только application/x-www-form-
      // urlencoded (см. /bnsi/ у Alloha), т.е. всегда ASCII-safe; CycleTLS
      // не принимает сырой Buffer, только строку.
      body: init.body ? init.body.toString('utf8') : undefined,
      ja3: CHROME_JA3,
      userAgent: CHROME_UA,
      proxy,
      responseType: 'arraybuffer',
    },
    method,
  );

  const body = Buffer.from(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers ?? {})) {
    headers[key.toLowerCase()] = String(value);
  }

  return { status: res.status, headers, body };
}
