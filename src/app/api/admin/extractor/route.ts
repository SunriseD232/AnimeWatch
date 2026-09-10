import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extractor — перезапуск общего Chromium на VPS-экстракторе.
 *
 * Кнопка живёт на /admin/status. Токен экстрактора остаётся на сервере — в
 * браузер он не уезжает, как и CRON_SECRET у ручного запуска задач (см.
 * api/admin/run-job). Проверка та же: ADMIN_EMAILS, остальным 404, чтобы сам
 * факт существования ручки не светился.
 */
export async function POST() {
  const {
    data: { user },
  } = await getCachedUser();
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const baseUrl = process.env.VPS_EXTRACTOR_URL;
  const token = process.env.VPS_EXTRACTOR_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: 'not_configured', message: 'VPS_EXTRACTOR_URL/TOKEN не заданы.' },
      { status: 500 },
    );
  }

  try {
    // Ждём ответа, а не отпускаем: сброс идёт через очередь браузера и может
    // подождать текущее извлечение, но это секунды, а не минуты — и человеку
    // важно увидеть, что именно произошло.
    const res = await fetch(new URL('/browser/reset', baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      before?: { extractions?: number; ageMinutes?: number };
      message?: string;
    };
    if (!res.ok) {
      return NextResponse.json(
        { error: 'reset_failed', message: body.message ?? `Экстрактор ответил ${res.status}` },
        { status: 502 },
      );
    }
    console.log(`[admin/extractor] Chromium сброшен вручную (${user?.email})`);
    return NextResponse.json({ ok: true, before: body.before ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'unreachable', message }, { status: 502 });
  }
}
