import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reportResolvedStream } from '@/lib/extract/resolve';
import { getMirrorSourceConfig } from '@/lib/mirror/sources';
import { isSafeUpstreamUrl } from '@/lib/mirror/validateUrl';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * POST /api/extract/report
 *
 * Клиент прислал ссылку, которую сам нашёл через зеркало (см. §12.6
 * ARCHITECTURE.md) — кладём её в тот же кэш (resolved_streams), которым
 * пользуется /api/proxy/.../[source]. Требует авторизации (сайт и так
 * закрыт целиком, см. §14) и валидирует URL (isSafeUpstreamUrl) — иначе
 * это открытый SSRF: /api/proxy делает СЕРВЕРНЫЙ fetch() по тому, что
 * здесь запишут. Referer берём из конфига источника, а не от клиента —
 * незачем доверять клиенту заголовки, которые сервер и так знает сам.
 */

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed']);

interface ReportBody {
  contentType?: string;
  id?: number;
  season?: number;
  episode?: number;
  source?: string;
  url?: string;
  isHls?: boolean;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ReportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const contentType = body.contentType === 'cinema' ? 'cinema' : body.contentType === 'anime' ? 'anime' : null;
  const shikimoriId = Number(body.id);
  const season = Number(body.season) || 1;
  const episode = Number(body.episode);
  const source = body.source as ExtractSource;

  if (
    !contentType ||
    !Number.isFinite(shikimoriId) ||
    !Number.isFinite(episode) ||
    !ALLOWED_SOURCES.has(source) ||
    typeof body.url !== 'string'
  ) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  if (!isSafeUpstreamUrl(body.url)) {
    return NextResponse.json({ error: 'unsafe_url' }, { status: 400 });
  }

  const config = getMirrorSourceConfig(source);
  if (!config) {
    return NextResponse.json({ error: 'unknown_source' }, { status: 400 });
  }

  await reportResolvedStream({
    contentType,
    shikimoriId,
    season,
    episode,
    source,
    resolved: {
      url: body.url,
      headers: { Referer: config.referer },
      isHls: body.url.includes('.m3u8'),
    },
  });

  return NextResponse.json({ ok: true });
}
