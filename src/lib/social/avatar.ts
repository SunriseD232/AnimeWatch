import { randomBytes } from 'crypto';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

/**
 * Аватары: приём, ужатие, хранение.
 *
 * ГДЕ ЛЕЖАТ. Supabase Storage на сервере не поднят (самохостинг без
 * контейнера storage), поэтому файлы живут на диске рядом с кэшем обложек
 * и отдаются nginx напрямую — тот же приём, что у /posters/ (см.
 * lib/posterCache.ts и конфиг nginx). Каталог вне сборок, деплой его не
 * трогает.
 *
 * ИМЯ ФАЙЛА — случайное, и меняется при каждой загрузке. Поэтому ссылку можно
 * кэшировать навсегда (новая картинка = новый адрес, старый кэш не
 * мешает), а по адресу нельзя угадать, чей это аватар.
 */

export const AVATAR_DIR = process.env.AVATAR_DIR ?? '/opt/mediawatch/avatars';
const AVATAR_SIDE = 512;
export const AVATAR_FILE_RE = /^[0-9a-f]{32}\.webp$/;

// Потолок на размер кадра при разборе: 5 МБ PNG легко разворачивается в
// сотни мегапикселей (так устроены «декомпрессионные бомбы»), и sharp
// честно попытался бы выделить под них память.
const MAX_INPUT_PIXELS = 60_000_000;

export class AvatarError extends Error {}

/**
 * Квадрат по центру интереса (sharp ищет, где в кадре «главное», — лицо не
 * срезается, как при кадрировании строго по центру), сторона не больше
 * 512 px, круглая маска с прозрачными углами, WebP.
 *
 * Круг вшит в сам файл, а не только в CSS: картинка, открытая по прямой
 * ссылке или вставленная куда-то ещё, остаётся круглой.
 */
export async function renderAvatar(input: Buffer): Promise<Buffer> {
  let image: sharp.Sharp;
  let side: number;
  try {
    image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new AvatarError('no size');
    // Ориентации 5-8 по EXIF — поворот на 90°: ширина и высота меняются местами.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;
    // Маленькие картинки не растягиваем: размытый аватар хуже маленького.
    side = Math.min(AVATAR_SIDE, width, height);
  } catch {
    throw new AvatarError('Не удалось прочитать изображение. Подойдёт JPEG, PNG, WebP или GIF.');
  }

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="#fff"/></svg>`,
  );

  try {
    return await image
      .resize(side, side, { fit: 'cover', position: sharp.strategy.attention })
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
  } catch {
    throw new AvatarError('Не удалось обработать изображение. Попробуйте другой файл.');
  }
}

/** Пишет файл атомарно и возвращает публичный путь вида /avatars/<имя>.webp. */
export async function storeAvatar(data: Buffer): Promise<string> {
  const name = `${randomBytes(16).toString('hex')}.webp`;
  await mkdir(AVATAR_DIR, { recursive: true });
  const target = join(AVATAR_DIR, name);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, target);
  return `/avatars/${name}`;
}

/** Удаляет прежний файл. Ошибки глотаем: осиротевший файл — не повод для 500. */
export async function removeAvatarFile(publicPath: string | null | undefined): Promise<void> {
  if (!publicPath) return;
  const name = publicPath.replace(/^\/avatars\//, '');
  if (!AVATAR_FILE_RE.test(name)) return;
  await unlink(join(AVATAR_DIR, name)).catch(() => {});
}
