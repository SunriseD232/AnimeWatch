import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// In-memory sliding window по IP — best-effort в рамках одного тёплого
// serverless-инстанса Vercel (сбрасывается на cold start / другом инстансе),
// но это ровно то, что задокументировано в ARCHITECTURE.md §12.7: первая
// линия защиты от спама очереди, а не строгая гарантия.
const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 5;
const ipHits = new Map<string, number[]>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length <= IP_LIMIT;
}

const DAILY_LIMIT_PER_USER = 3;

/**
 * POST /api/download
 * Создаёт задачу на скачивание серии/фильма в Telegram.
 * Тело: { content_type, source, shikimori_id, anime_title, poster_url, season, episode, tg_id }
 */
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  if (!checkIpRateLimit(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const tgId = String(body.tg_id ?? '').trim();
  const contentType =
    body.content_type === 'cinema' ? 'cinema' : 'anime';
  const shikimoriId = Number(body.shikimori_id);
  const season = Number(body.season) || 1;
  const episode = Number(body.episode);
  const animeTitle = String(body.anime_title ?? 'Без названия');
  const posterUrl = body.poster_url ? String(body.poster_url) : null;
  const ALLOWED_SOURCES = ['anilibria', 'alloha', 'videoseed'] as const;
  const source = ALLOWED_SOURCES.includes(body.source as (typeof ALLOWED_SOURCES)[number])
    ? (body.source as (typeof ALLOWED_SOURCES)[number])
    : null;

  if (!tgId || !Number.isFinite(shikimoriId) || !Number.isFinite(episode) || episode < 1) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  // Проверяем, что telegram_id привязан к аккаунту.
  const { data: link } = await supabase
    .from('telegram_links')
    .select('telegram_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!link || link.telegram_id !== tgId) {
    return NextResponse.json({ error: 'telegram_not_linked' }, { status: 400 });
  }

  // Проверяем, нет ли уже такой задачи в очереди.
  const { data: existing } = await supabase
    .from('download_queue')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('shikimori_id', shikimoriId)
    .eq('season', season)
    .eq('episode', episode)
    .in('status', ['pending', 'extracting', 'downloading', 'sending'])
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, status: existing.status });
  }

  // Дневной лимит — считаем реальные новые задачи за последние 24ч, а не
  // повторные проверки статуса (те выше уходят через ветку `existing`).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from('download_queue')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dayAgo);

  if ((dailyCount ?? 0) >= DAILY_LIMIT_PER_USER) {
    return NextResponse.json({ error: 'daily_limit' }, { status: 429 });
  }

  // Создаём задачу.
  const { data, error } = await supabase
    .from('download_queue')
    .insert({
      user_id: user.id,
      tg_id: tgId,
      content_type: contentType,
      shikimori_id: shikimoriId,
      anime_title: animeTitle,
      poster_url: posterUrl,
      season,
      episode,
      source,
      status: 'pending',
    })
    .select('id, status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}

/**
 * GET /api/download?shikimori_id=...&season=...&episode=...
 * Возвращает статус задачи скачивания.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const shikimoriId = Number(searchParams.get('shikimori_id'));
  const season = Number(searchParams.get('season')) || 1;
  const episode = Number(searchParams.get('episode'));

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode)) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  const { data } = await supabase
    .from('download_queue')
    .select('id, status, error, file_id')
    .eq('user_id', user.id)
    .eq('shikimori_id', shikimoriId)
    .eq('season', season)
    .eq('episode', episode)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(data ?? { status: null });
}
