import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { ContentType, WatchProgressInput } from '@/lib/types';

/**
 * Upsert прогресса просмотра. Вызывается как обычным fetch (keepalive),
 * так и navigator.sendBeacon при beforeunload — поэтому логика на сервере,
 * а не в браузерном клиенте (beacon отправляет cookies сессии).
 */
export async function POST(request: NextRequest) {
  let body: Partial<WatchProgressInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) {
    // Аноним — просто ничего не сохраняем.
    return NextResponse.json({ ok: false, reason: 'anon' }, { status: 200 });
  }

  const logTag = `[progress] user=${user.id}`;

  const shikimoriId = Number(body.shikimori_id);
  const episode = Number(body.episode);
  // Сезон опционален: аниме/фильмы шлют 1 (или вовсе не шлют).
  const seasonRaw = Number(body.season);
  const season = Number.isFinite(seasonRaw) && seasonRaw >= 1 ? seasonRaw : 1;
  const position = Number(body.position_seconds);
  // Все шесть типов (миграция 0053 расширила constraint). Незнакомое значение
  // по-прежнему падает в 'anime' — так же, как было до книг: молча.
  const contentType: ContentType =
    body.content_type === 'cinema' ||
    body.content_type === 'podcast' ||
    body.content_type === 'book' ||
    body.content_type === 'manga' ||
    body.content_type === 'ranobe'
      ? body.content_type
      : 'anime';
  // Источник (flibusta/remanga/…) — только у книг/манги/ранобэ. Пишем как
  // есть: свободный текст, а не enum, чтобы новый источник не требовал
  // миграции.
  const source = typeof body.source === 'string' && body.source ? body.source : null;
  // Единица позиции. Книга шлёт 'percent', манга — 'page', видео/подкаст —
  // 'seconds' (или не шлёт вовсе). Незнакомое — 'seconds'.
  const unit =
    body.unit === 'page' || body.unit === 'chapter' || body.unit === 'percent'
      ? body.unit
      : 'seconds';
  // Доля прочитанного. Ранобэ и манга шлют её вместе с unit='chapter'/'page':
  // прогресс — это глава (episode) плюс доля прокрутки внутри неё, а
  // progress_percent хранит общий процент по тайтлу. Без этого «продолжить»
  // показывало бы только номер главы и теряло место внутри неё.
  const percentRaw = Number(body.progress_percent);
  const progressPercent =
    (unit === 'percent' || unit === 'chapter' || unit === 'page') &&
    Number.isFinite(percentRaw)
      ? Math.max(0, Math.min(1, percentRaw))
      : null;
  const locator =
    body.locator && typeof body.locator === 'object' && !Array.isArray(body.locator)
      ? body.locator
      : null;
  // Режим «отметить открытую серию»: нужен для Videoseed, который не сообщает
  // странице позицию воспроизведения. Пишем прогресс на уровне сезон/серия.
  const isMark = body.mark === true;

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode)) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  // --- Пометки о завершении (могут прийти вместе или по отдельности) ------
  // watched_episode: серия season/episode досмотрена — для подсветки в сетках.
  // completed: тайтл целиком просмотрен — в списке ставится «Просмотрено».
  //
  // Ветка НЕ выходит из обработчика: пометка приходит тем же запросом, что и
  // позиция (см. useProgressSaver — досмотренность отмечает обычное
  // периодическое сохранение), и обрывать его здесь значило бы терять
  // позицию. По той же причине падение одной записи больше не отменяет
  // остальные: раньше ошибка на watched_episodes отдавала 500 ДО обработки
  // completed, и досмотренный до конца тайтл не попадал в «Просмотрено» —
  // ровно это и происходило, пока у watched_episodes не было
  // UPDATE-политики (миграция 0035).
  const failures: string[] = [];
  const hasFlags = body.watched_episode === true || body.completed === true;

  if (body.watched_episode === true) {
    const { error } = await supabase.from('watched_episodes').upsert(
      {
        user_id: user.id,
        content_type: contentType,
        shikimori_id: shikimoriId,
        season,
        episode,
        anime_title: body.anime_title ?? null,
        poster_url: body.poster_url ?? null,
        source,
      },
      {
        // Было ignoreDuplicates: true (ON CONFLICT DO NOTHING) — из-за
        // этого строки, отмеченные ДО того, как сюда добавили title/
        // poster_url (миграция 0017), никогда не получали их: конфликт по
        // тому же (user, content_type, shikimori_id, season, episode)
        // просто молча игнорировался. Теперь конфликт обновляет title/
        // poster_url — новый повтор той же серии их подтянет.
        onConflict: 'user_id,content_type,shikimori_id,season,episode',
      },
    );
    if (error) {
      console.error(`${logTag} watched_episode upsert failed: ${error.message}`);
      failures.push(`watched_episode: ${error.message}`);
    } else {
      console.log(`${logTag} watched_episode content=${contentType} id=${shikimoriId} s=${season} e=${episode}`);
    }
  }

  if (body.completed === true) {
    const { error } = await supabase.from('user_list').upsert(
      {
        user_id: user.id,
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: body.anime_title ?? 'Без названия',
        poster_url: body.poster_url ?? null,
        status: 'completed',
        source,
      },
      { onConflict: 'user_id,content_type,shikimori_id' },
    );
    if (error) {
      console.error(`${logTag} completed upsert failed: ${error.message}`);
      failures.push(`completed: ${error.message}`);
    } else {
      console.log(`${logTag} completed content=${contentType} id=${shikimoriId}`);
    }
  }

  if (isMark) {
    // Не затираем точную позицию, если эта же серия уже сохранена (например,
    // её раньше писал Kodik с точностью до секунды).
    const { data: existing } = await supabase
      .from('watch_progress')
      .select('season, episode')
      .eq('user_id', user.id)
      .eq('content_type', contentType)
      .eq('shikimori_id', shikimoriId)
      .maybeSingle();
    if (
      existing &&
      (existing.season ?? 1) === season &&
      existing.episode === episode
    ) {
      return NextResponse.json({ ok: true, kept: true });
    }
    const { error: markError } = await supabase.from('watch_progress').upsert(
      {
        user_id: user.id,
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: body.anime_title ?? 'Без названия',
        poster_url: body.poster_url ?? null,
        season,
        episode,
        position_seconds: 0,
        duration_seconds: null,
        translation_id:
          body.translation_id != null ? Number(body.translation_id) : null,
        translation_title: body.translation_title ?? null,
        source,
        unit,
        progress_percent: progressPercent,
        locator,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,content_type,shikimori_id' },
    );
    if (markError) {
      console.error(`${logTag} mark upsert failed: ${markError.message}`);
      return NextResponse.json({ error: markError.message }, { status: 500 });
    }
    console.log(`${logTag} mark content=${contentType} id=${shikimoriId} s=${season} e=${episode}`);
    return NextResponse.json({ ok: true, marked: true });
  }

  // Не сохраняем случайные открытия (< 5 сек). Для чтения это условие
  // неприменимо: у книги позиция в страницах/процентах, и «первая страница» —
  // законное место остановки. Поэтому у не-секундных юнитов проверяем иначе.
  const hasPosition =
    unit === 'seconds'
      ? Number.isFinite(position) && position >= 5
      : Number.isFinite(position) || progressPercent != null;

  if (hasPosition) {
    const { error } = await supabase.from('watch_progress').upsert(
      {
        user_id: user.id,
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: body.anime_title ?? 'Без названия',
        poster_url: body.poster_url ?? null,
        season,
        episode,
        position_seconds: Number.isFinite(position) ? position : 0,
        duration_seconds:
          body.duration_seconds != null
            ? Number(body.duration_seconds)
            : null,
        translation_id:
          body.translation_id != null ? Number(body.translation_id) : null,
        translation_title: body.translation_title ?? null,
        source,
        unit,
        progress_percent: progressPercent,
        locator,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,content_type,shikimori_id' },
    );
    if (error) {
      // Обычное периодическое сохранение позиции (интервал, см.
      // useProgressSaver) не логируем на успехе — слишком часто, чтобы нести
      // диагностическую ценность построчно. Ошибка тут редкая и всегда важна.
      console.error(`${logTag} position upsert failed: ${error.message}`);
      failures.push(`position: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    return NextResponse.json({ error: failures.join('; ') }, { status: 500 });
  }
  if (!hasPosition && !hasFlags) {
    return NextResponse.json({ ok: false, reason: 'too-early' });
  }
  return NextResponse.json({ ok: true });
}
