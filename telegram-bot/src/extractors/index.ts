import type { DownloadTask } from '../supabase.js';
import { extractAnilibria } from './anilibria.js';
import { extractAlloha } from './alloha.js';
import { extractVideoseed } from './videoseed.js';

/**
 * Определяет источник и извлекает прямую видео-ссылку.
 *
 * task.source — то, что пользователь реально смотрел в плеере на сайте
 * (DownloadButton передаёт его явно). Если задан — качаем строго из него,
 * без подмены на другой источник: пользователь ожидает именно ту версию,
 * которую видел. Фолбэк AniLibria→Alloha остаётся только для старых задач
 * без source (до миграции 0007) — тогда его и не могло быть.
 */
export async function extractVideoUrl(task: DownloadTask): Promise<string | null> {
  if (task.content_type === 'anime') {
    if (task.source === 'alloha') {
      const allohaUrl = await extractAlloha(task.shikimori_id, task.episode);
      if (allohaUrl) {
        console.log(`[extract] Alloha: ${allohaUrl.slice(0, 80)}...`);
        return allohaUrl;
      }
      return null;
    }

    if (task.source === 'anilibria') {
      const anilibriaUrl = await extractAnilibria(task.shikimori_id, task.episode);
      if (anilibriaUrl) {
        console.log(`[extract] AniLibria: ${anilibriaUrl.slice(0, 80)}...`);
        return anilibriaUrl;
      }
      return null;
    }

    // Старая задача без source (до миграции 0007) — прежнее поведение.
    const anilibriaUrl = await extractAnilibria(task.shikimori_id, task.episode);
    if (anilibriaUrl) {
      console.log(`[extract] AniLibria: ${anilibriaUrl.slice(0, 80)}...`);
      return anilibriaUrl;
    }

    const allohaUrl = await extractAlloha(task.shikimori_id, task.episode);
    if (allohaUrl) {
      console.log(`[extract] Alloha (фолбэк): ${allohaUrl.slice(0, 80)}...`);
      return allohaUrl;
    }

    return null;
  }

  // content_type === 'cinema'
  const videoseedUrl = await extractVideoseed(
    task.shikimori_id, // для cinema это kinopoisk_id
    task.season,
    task.episode,
  );
  if (videoseedUrl) {
    console.log(`[extract] Videoseed: ${videoseedUrl.slice(0, 80)}...`);
    return videoseedUrl;
  }

  return null;
}
