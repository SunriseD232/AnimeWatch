'use client';

import { useEffect, useRef, useState } from 'react';

// --- Типы ответа AniLibria API v1 ---
interface AniName {
  main: string | null;
  english: string | null;
}
interface AniEpisode {
  id: string;
  name: string | null;
  ordinal: number;
  duration: number;
  hls_480: string | null;
  hls_720: string | null;
  hls_1080: string | null;
}
interface AniRelease {
  id: number;
  alias: string;
  name: AniName;
  episodes: AniEpisode[];
  is_blocked_by_geo: boolean;
}
interface AniSearchItem {
  id: number;
  alias: string;
  name: AniName;
}

const API = 'https://anilibria.top/api/v1';
type Quality = '1080' | '720' | '480';

export default function HlsProbe() {
  const [query, setQuery] = useState('naruto');
  const [results, setResults] = useState<AniSearchItem[]>([]);
  const [release, setRelease] = useState<AniRelease | null>(null);
  const [epIndex, setEpIndex] = useState(0);
  const [quality, setQuality] = useState<Quality>('1080');
  const [status, setStatus] = useState<string>('');
  const [resolution, setResolution] = useState<string>('—');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const episode = release?.episodes[epIndex] ?? null;
  const srcFor = (ep: AniEpisode | null, q: Quality): string | null => {
    if (!ep) return null;
    return q === '1080' ? ep.hls_1080 : q === '720' ? ep.hls_720 : ep.hls_480;
  };

  async function search() {
    setStatus('Поиск…');
    setRelease(null);
    try {
      const res = await fetch(
        `${API}/app/search/releases?query=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as AniSearchItem[];
      setResults(Array.isArray(data) ? data : []);
      setStatus(data.length ? '' : 'Ничего не найдено');
    } catch (e) {
      setStatus(`Ошибка поиска: ${(e as Error).message}`);
    }
  }

  async function openRelease(id: number) {
    setStatus('Загружаю эпизоды…');
    try {
      const res = await fetch(`${API}/anime/releases/${id}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const rel = (await res.json()) as AniRelease;
      setRelease(rel);
      setEpIndex(0);
      setStatus(
        rel.is_blocked_by_geo
          ? '⚠ Тайтл помечен как заблокированный по гео'
          : `Загружено серий: ${rel.episodes.length}`,
      );
    } catch (e) {
      setStatus(`Ошибка: ${(e as Error).message}`);
    }
  }

  // При смене серии выбираем максимальное доступное качество.
  useEffect(() => {
    if (!episode) return;
    const best: Quality = episode.hls_1080
      ? '1080'
      : episode.hls_720
        ? '720'
        : '480';
    setQuality(best);
  }, [episode]);

  // Загрузка потока в <video> через hls.js при смене серии/качества.
  useEffect(() => {
    const video = videoRef.current;
    const src = srcFor(episode, quality);
    if (!video || !src) return;

    let cancelled = false;

    (async () => {
      // Чистим прошлый инстанс.
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;

      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setStatus(`HLS ошибка: ${data.type} / ${data.details}`);
        });
      } else if (canNative) {
        video.src = src; // Safari/iOS
      } else {
        setStatus('Браузер не поддерживает HLS');
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [episode, quality]);

  // Индикатор реального разрешения.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth) {
        setResolution(`${video.videoWidth}×${video.videoHeight}`);
      }
    };
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    const id = setInterval(update, 1000);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      clearInterval(id);
    };
  }, []);

  // Поиск при первом рендере.
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">
          Прототип: AniLibria + hls.js
        </h1>
        <p className="text-sm text-gray-400">
          Проверка доступности потока и реального 1080p из вашей сети.
        </p>
      </div>

      {/* Поиск */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название (напр. naruto, ван-пис)…"
          className="flex-1 rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Найти
        </button>
      </form>

      {status && <p className="text-sm text-gray-400">{status}</p>}

      {/* Результаты поиска */}
      {!release && results.length > 0 && (
        <div className="flex flex-col gap-1">
          {results.slice(0, 8).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openRelease(r.id)}
              className="rounded-lg bg-bg-card px-4 py-2.5 text-left text-sm hover:bg-bg-soft"
            >
              {r.name.main ?? r.alias}
              <span className="ml-2 text-xs text-gray-500">#{r.id}</span>
            </button>
          ))}
        </div>
      )}

      {/* Плеер */}
      {release && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {release.name.main ?? release.alias}
            </h2>
            <button
              type="button"
              onClick={() => setRelease(null)}
              className="text-sm text-gray-400 hover:text-white"
            >
              ← к поиску
            </button>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
            <video
              ref={videoRef}
              controls
              playsInline
              className="absolute inset-0 h-full w-full"
            />
          </div>

          {/* Индикатор разрешения */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-md bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300">
              Реальное разрешение: {resolution}
            </span>
            <span className="text-gray-400">Качество:</span>
            {(['1080', '720', '480'] as Quality[]).map((q) => {
              const available = !!srcFor(episode, q);
              return (
                <button
                  key={q}
                  type="button"
                  disabled={!available}
                  onClick={() => setQuality(q)}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm font-medium transition',
                    quality === q
                      ? 'bg-accent text-white'
                      : available
                        ? 'bg-bg-card text-gray-200 hover:bg-bg-soft'
                        : 'cursor-not-allowed bg-bg-card/40 text-gray-600',
                  ].join(' ')}
                >
                  {q}p
                </button>
              );
            })}
          </div>

          {/* Список серий */}
          {release.episodes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {release.episodes.map((ep, i) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => setEpIndex(i)}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm ring-1 transition',
                    i === epIndex
                      ? 'bg-accent text-white ring-accent'
                      : 'bg-bg-card text-gray-300 ring-white/5 hover:bg-bg-soft',
                  ].join(' ')}
                >
                  {ep.ordinal}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
