import { exec } from 'child_process';
import { unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import type { DownloadTask } from './supabase.js';

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_BYTES) || 1_500_000_000; // 1.5 GB
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 900_000; // 15 минут

/**
 * Скачивает видео через ffmpeg и отправляет в Telegram.
 */
export async function downloadAndSend(
  supabase: SupabaseClient,
  bot: Telegraf,
  task: DownloadTask,
  videoUrl: string,
): Promise<void> {
  const tempFile = join(tmpdir(), `mediawatch_${task.id}.mp4`);

  try {
    // 1. Скачиваем через ffmpeg.
    console.log(`[download] Скачивание ${videoUrl.slice(0, 80)}...`);

    await supabase
      .from('download_queue')
      .update({ status: 'downloading' })
      .eq('id', task.id);

    // ffmpeg: копируем поток без перекодирования (быстро, мало CPU).
    // Если видео в HLS — ffmpeg сам склеит сегменты.
    const ffmpegCmd = [
      'ffmpeg',
      '-y',
      '-i', videoUrl,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '1024',
      tempFile,
    ];

    console.log(`[ffmpeg] ${ffmpegCmd.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
      const proc = exec(ffmpegCmd.join(' '), {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 10, // 10 MB stdout/stderr
      }, (error, stdout, stderr) => {
        if (error) {
          // ffmpeg возвращает ненулевой код даже при успехе с некоторыми кодеками
          // Проверяем, создался ли файл.
          if (existsSync(tempFile)) {
            resolve();
          } else {
            reject(new Error(`ffmpeg: ${error.message}\nstderr: ${stderr.slice(0, 500)}`));
          }
        } else {
          resolve();
        }
      });
    });

    // Проверяем размер файла.
    const stats = statSync(tempFile);
    const fileSize = stats.size;

    console.log(`[download] Файл: ${tempFile}, размер: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`Файл слишком большой: ${(fileSize / 1024 / 1024).toFixed(1)} MB > ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`);
    }

    // 2. Отправляем в Telegram.
    console.log(`[send] Отправка ${task.anime_title}...`);

    await supabase
      .from('download_queue')
      .update({ status: 'sending', file_size_bytes: fileSize })
      .eq('id', task.id);

    const caption = [
      `🎬 ${task.anime_title}`,
      task.content_type === 'cinema'
        ? `Сезон ${task.season} · Серия ${task.episode}`
        : `Серия ${task.episode}`,
    ].join('\n');

    const video = await bot.telegram.sendVideo(
      task.tg_id,
      { source: tempFile, filename: `mediawatch_${task.shikimori_id}_s${task.season}e${task.episode}.mp4` },
      {
        caption,
        supports_streaming: true,
        width: 1920,
        height: 1080,
      },
    );

    const fileId = video.video?.file_id ?? null;

    // 3. Отмечаем задачу как выполненную.
    await supabase
      .from('download_queue')
      .update({
        status: 'completed',
        file_id: fileId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    console.log(`[send] Готово! file_id: ${fileId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[send] Ошибка:', message);

    await supabase
      .from('download_queue')
      .update({
        status: 'failed',
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    throw err;
  } finally {
    // 4. Удаляем временный файл.
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
        console.log(`[cleanup] Удалён ${tempFile}`);
      }
    } catch {
      // Игнорируем ошибки удаления.
    }
  }
}
