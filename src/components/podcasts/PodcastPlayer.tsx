'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import PosterImage from '@/components/PosterImage';
import AudioControls, { SKIP_SECONDS, type AudioControlsActions, type AudioControlsState } from '@/components/audio/AudioControls';
import { useAudioPlayer, type AudioSession } from '@/components/audio/AudioPlayerProvider';
import type { PodcastEpisode } from '@/lib/podcastShared';

/**
 * Плеер выпуска подкаста — пульт общего плеера (AudioPlayerProvider).
 *
 * Звук живёт в корневом layout, а не здесь (24.10.2026): уход со страницы
 * больше не обрывает выпуск — он продолжается в полоске внизу. Эта
 * страница либо управляет общим плеером (играет этот же выпуск), либо
 * показывает свой выпуск, и «Слушать» переключает общий плеер на него.
 *
 * Источник — подписанные ссылки нашего /api/proxy/raw (lib/podcasts.ts →
 * podcastAudioUrl): смешанный контент http-фидов, хотлинк-запреты CDN,
 * приватность. Подписаны все выпуски — чтобы из полоски внизу можно было
 * включить следующий, не заходя на его страницу.
 *
 * Прогресс и место в каждом выпуске сохраняет общий плеер. Автоперехода к
 * следующему выпуску нет: выпуски не связаны сюжетом.
 */
export default function PodcastPlayer({
  podcastId,
  podcastTitle,
  artworkUrl,
  episode,
  episodes,
  isAuthed,
  /** Позиция в секундах, с которой продолжить, 0 — с начала. */
  startPosition = 0,
}: {
  podcastId: number;
  podcastTitle: string;
  artworkUrl: string | null;
  episode: PodcastEpisode;
  /** Все выпуски с подписанными audioUrl — для «предыдущий/следующий». */
  episodes: PodcastEpisode[];
  isAuthed: boolean;
  startPosition?: number;
}) {
  const audio = useAudioPlayer();
  const router = useRouter();

  const session: AudioSession = useMemo(
    () => ({
      kind: 'podcast',
      id: podcastId,
      title: podcastTitle,
      subtitle: null,
      coverUrl: artworkUrl,
      tracks: episodes.map((e) => ({
        index: e.index,
        title: e.title,
        url: e.audioUrl,
        durationSeconds: e.durationSeconds,
        imageUrl: e.imageUrl,
      })),
      pageHref: `/podcasts/listen/${podcastId}`,
      isAuthed,
      autoAdvance: false,
    }),
    [podcastId, podcastTitle, artworkUrl, episodes, isAuthed],
  );

  const hrefOf = (index: number) => `/podcasts/listen/${podcastId}/${index}`;
  const position = episodes.findIndex((e) => e.index === episode.index);
  const prev = position > 0 ? episodes[position - 1] : null;
  const next = position >= 0 && position < episodes.length - 1 ? episodes[position + 1] : null;

  const isThis = audio.isActive('podcast', podcastId) && audio.track?.index === episode.index;
  const otherPlaying = audio.session && !isThis ? audio.track : null;

  // Этот выпуск играет — пульт общего плеера; «пред./след.» ещё и ведут
  // на страницу того выпуска, чтобы страница не расходилась со звуком.
  // Не играет — свой выпуск: «Слушать» и перемотка включают его.
  const state: AudioControlsState = isThis
    ? audio.state
    : {
        ...audio.state,
        playing: false,
        current: startPosition,
        duration: episode.durationSeconds,
        hasPrev: !!prev,
        hasNext: !!next,
      };

  const actions: AudioControlsActions = isThis
    ? {
        ...audio.actions,
        prev: () => {
          if (!prev) return;
          audio.actions.prev();
          router.push(hrefOf(prev.index));
        },
        next: () => {
          if (!next) return;
          audio.actions.next();
          router.push(hrefOf(next.index));
        },
      }
    : {
        ...audio.actions,
        toggle: () => audio.start(session, episode.index, startPosition, true),
        seek: (seconds) => audio.start(session, episode.index, seconds, false),
        skip: (delta) => audio.start(session, episode.index, Math.max(0, startPosition + delta), false),
        prev: () => {
          if (prev) router.push(hrefOf(prev.index));
        },
        next: () => {
          if (next) router.push(hrefOf(next.index));
        },
      };

  // Пробел — пауза, стрелки — ±10 с. Не в полях ввода и не на кнопках.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select|button/i.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        actionsRef.current.toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        actionsRef.current.skip(SKIP_SECONDS);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        actionsRef.current.skip(-SKIP_SECONDS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {otherPlaying ? (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-gray-400">
          Сейчас играет: {otherPlaying.title}
          {audio.session && audio.session.id !== podcastId ? ` — ${audio.session.title}` : ''}. «Слушать»
          здесь переключит на этот выпуск.
        </p>
      ) : null}

      <div className="flex items-start gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-bg-soft sm:h-24 sm:w-24">
          <PosterImage sources={[episode.imageUrl, artworkUrl]} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{episode.title}</p>
          {episode.publishedAt ? (
            <p className="text-xs text-gray-400">
              {new Date(episode.publishedAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          ) : null}
        </div>
      </div>

      <AudioControls state={state} actions={actions} prevLabel="Предыдущий выпуск" nextLabel="Следующий выпуск" />

      {prev || next ? (
        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
          {prev ? (
            <Link href={hrefOf(prev.index)} className="hover:text-white" title={prev.title}>
              ← {prev.title}
            </Link>
          ) : null}
          {next ? (
            <Link href={hrefOf(next.index)} className="ml-auto hover:text-white" title={next.title}>
              {next.title} →
            </Link>
          ) : null}
        </div>
      ) : null}

      {!isAuthed ? (
        <p className="text-xs text-gray-400">
          Войдите, чтобы прогресс слушания сохранялся и подкаст появился в «Продолжить слушать».
        </p>
      ) : null}
    </div>
  );
}
