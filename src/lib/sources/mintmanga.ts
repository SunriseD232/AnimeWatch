/**
 * MintManga — тот же движок ReadManga, но с нюансом.
 *
 * Проверено живьём:
 *   - API-поиск: `https://1.mintmanga.com/api/catalog/search?q=...` — работает;
 *   - HTML-страницы требуют `Referer: https://1.mintmanga.com/`;
 *   - 18+ главы уводят на `3.grouple.co/internal/auth/login` (save-mature),
 *     то есть требуют аккаунт. Обходить авторизацию нельзя.
 *
 * Поэтому адаптер выключен по умолчанию: он умеет маппинг и оглавление, но
 * для закрытых глав вернёт null. Включать — только осознанно, флагом
 * SOURCE_MINTMANGA=enabled.
 */

import { createReadmangaEngineAdapter } from './readmangaEngine';

export const mintmanga = createReadmangaEngineAdapter({
  id: 'mintmanga',
  host: 'https://1.mintmanga.com',
});
