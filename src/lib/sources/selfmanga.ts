/**
 * SelfManga — движок ReadManga, работает анонимно.
 *
 * Проверено живьём: `https://1.selfmanga.live/api/catalog/search?q=...`,
 * тайтл и главы в HTML, страницы в `rm_h.readerInit`, картинки на
 * `*.one-way.work`.
 */

import { createReadmangaEngineAdapter } from './readmangaEngine';

export const selfmanga = createReadmangaEngineAdapter({
  id: 'selfmanga',
  host: 'https://1.selfmanga.live',
});
