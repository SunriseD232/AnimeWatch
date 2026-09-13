import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';
import { AVATAR_DIR, AVATAR_FILE_RE } from '@/lib/social/avatar';

/**
 * Отдача аватара, если до приложения дошёл запрос /avatars/<файл>.
 *
 * На проде сюда не попадают: /avatars/ отдаёт nginx прямо с диска, как и
 * /posters/. Маршрут нужен локальной разработке, где nginx нет, и как
 * страховка — без него забытая строка в конфиге nginx означала бы битые
 * аватары у всех, а так только чуть более медленные.
 */
export async function GET(_request: Request, { params }: { params: { file: string } }) {
  if (!AVATAR_FILE_RE.test(params.file)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const data = await readFile(join(AVATAR_DIR, params.file));
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/webp',
        // Имя меняется при каждой загрузке — содержимое по адресу неизменно.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
