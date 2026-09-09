import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { JOBS, type JobName, isJobName } from '@/lib/adminJobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/run-job — запуск фоновой джобы руками, со страницы
 * /admin/status.
 *
 * Зачем не дёргать /api/cron/* прямо из браузера: они закрыты CRON_SECRET, а
 * светить его в клиентском коде нельзя. Здесь проверка — по личности
 * (ADMIN_EMAILS), как на самой странице, а секрет остаётся на сервере.
 *
 * Запрос уходит на 127.0.0.1 тем же путём, каким ходит системный крон (см.
 * `crontab -l`): один и тот же вход, одно и то же логирование, одни и те же
 * записи в *_index_state. Ничего параллельного «только для админки» не
 * заводим — расходиться этим двум путям незачем.
 *
 * Ответ НЕ дожидается конца работы: перестройка индекса аниме идёт около 13
 * минут, рейтинги — до 100. Отдаём «запущено» сразу, а исход смотрится на той
 * же странице состояния, она читает те же state-таблицы.
 */

/** Уже идёт? Смотрим по state-таблице: начало позже конца — значит идёт. */
async function alreadyRunning(job: JobName): Promise<boolean> {
  const def = JOBS[job];
  if (!def.state) return false;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from(def.state.table)
    .select(`${def.state.startedColumn}, ${def.state.finishedColumn}`)
    .eq('id', true)
    .maybeSingle();
  if (!data) return false;

  const row = data as Record<string, string | null>;
  const started = row[def.state.startedColumn];
  const finished = row[def.state.finishedColumn];
  if (!started) return false;
  if (finished && Date.parse(finished) >= Date.parse(started)) return false;

  // Незавершённый прогон висит вечно, если процесс упал по-жёсткому (OOM,
  // pm2 restart в середине). Тогда «идёт» — враньё, которое навсегда
  // запретит запуск. За пределами разумного бюджета считаем, что не идёт.
  return Date.now() - Date.parse(started) < def.maxRunMs;
}

export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!isAdminEmail(user?.email)) {
    // 404, а не 403: как и сама страница, ручка не должна подтверждать
    // своё существование постороннему.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { job?: unknown } | null;
  const job = body?.job;
  // Строгий список, а не подстановка присланного в путь: иначе это была бы
  // ручка «сходи от имени сервера куда скажут».
  if (typeof job !== 'string' || !isJobName(job)) {
    return NextResponse.json({ error: 'unknown_job' }, { status: 400 });
  }

  if (await alreadyRunning(job)) {
    return NextResponse.json(
      { error: 'already_running', message: 'Прогон уже идёт — дождитесь конца.' },
      { status: 409 },
    );
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'no_secret', message: 'На сервере не задан CRON_SECRET.' },
      { status: 500 },
    );
  }

  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/cron/${job}`;

  // Намеренно без await: ответ клиенту уходит сразу, а работа продолжается в
  // процессе PM2 — он живой и никем не прерывается (это не serverless).
  // .catch обязателен: необработанный reject у «отпущенного» промиса роняет
  // весь воркер.
  void fetch(url, { headers: { Authorization: `Bearer ${secret}` } }).catch((err) => {
    console.error(`[admin/run-job] ${job} не запустился:`, err);
  });

  console.log(`[admin/run-job] ${job} запущен вручную (${user?.email})`);
  return NextResponse.json({ ok: true, job });
}
