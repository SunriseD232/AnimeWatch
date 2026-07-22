import type { SupabaseClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import type { DownloadTask } from './supabase.js';
import { extractVideoUrl } from './extractors/index.js';
import { downloadAndSend } from './sender.js';

const MAX_RETRIES = 3;
const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000; // 15 минут

/**
 * Обрабатывает очередь скачивания: берёт одно задание, выполняет, завершает.
 * Concurrency = 1, без параллельных операций.
 */
export async function processQueue(
  supabase: SupabaseClient,
  bot: Telegraf,
): Promise<void> {
  // 1. Чистим зависшие задачи (processing дольше HEARTBEAT_TIMEOUT_MS).
  const heartbeatThreshold = new Date(
    Date.now() - HEARTBEAT_TIMEOUT_MS,
  ).toISOString();
  await supabase
    .from('download_queue')
    .update({ status: 'pending', error: 'heartbeat_timeout', retry_count: 0 })
    .in('status', ['extracting', 'downloading', 'sending'])
    .lt('started_at', heartbeatThreshold);

  // 2. Захватываем задачу атомарно через RPC (FOR UPDATE SKIP LOCKED).
  const { data: tasks, error } = await supabase.rpc('claim_download_task');

  if (error) {
    console.error('Ошибка захвата задачи:', error);
    return;
  }

  const claimedTask = (tasks as DownloadTask[] | null)?.[0];
  if (!claimedTask) return;

  console.log(`[queue] Обработка задачи ${claimedTask.id}: ${claimedTask.anime_title} s${claimedTask.season}e${claimedTask.episode} (source: ${claimedTask.source})`);

  try {
    // 3. Извлекаем видео-URL.
    console.log(`[extract] Извлечение видео для ${claimedTask.anime_title} (source: ${claimedTask.source})...`);
    const videoUrl = await extractVideoUrl(claimedTask);

    if (!videoUrl) {
      throw new Error('Не удалось извлечь видео-URL');
    }

    console.log(`[extract] URL получен: ${videoUrl.slice(0, 100)}...`);

    // Сохраняем URL.
    await supabase
      .from('download_queue')
      .update({ video_url: videoUrl, status: 'downloading' })
      .eq('id', claimedTask.id);

    // 4. Скачиваем и отправляем.
    await downloadAndSend(supabase, bot, claimedTask, videoUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[queue] Ошибка задачи ${claimedTask.id}:`, message);

    await supabase
      .from('download_queue')
      .update({
        status: 'failed',
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', claimedTask.id);
  }
}
