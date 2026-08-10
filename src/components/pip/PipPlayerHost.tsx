'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import OwnPlayer from '@/components/OwnPlayer';

type OwnPlayerProps = ComponentProps<typeof OwnPlayer>;

interface Session {
  key: string;
  props: OwnPlayerProps;
}

interface PipHostContextValue {
  /** Регистрирует/обновляет сессию «Нашего плеера» для тайтла key —
   *  вызывается на каждом рендере страницы просмотра, пока на ней открыт
   *  этот источник (см. Player.tsx/WatchPlayer.tsx). */
  show: (key: string, props: OwnPlayerProps, dock: HTMLDivElement) => void;
  /** Снять текущий dock — страница просмотра размонтировалась или ушла с
   *  вкладки «Наш плеер». Если для key сейчас активен Picture-in-Picture —
   *  сессия не закрывается, видео остаётся жить в скрытом контейнере
   *  держателя. */
  hide: (key: string) => void;
}

const PipHostContext = createContext<PipHostContextValue | null>(null);

export function usePipPlayerHost(): PipHostContextValue {
  const ctx = useContext(PipHostContext);
  if (!ctx) throw new Error('usePipPlayerHost вызван вне PipPlayerHost');
  return ctx;
}

/**
 * Постоянный держатель «Нашего плеера» — смонтирован один раз в корневом
 * layout и не размонтируется при переходах между страницами (см.
 * app/layout.tsx). Страницы просмотра (Player.tsx/WatchPlayer.tsx) НЕ
 * рендерят OwnPlayer напрямую — вместо этого рендерят пустой контейнер
 * (dock) и просят через show()/hide() ЭТОТ компонент отрисовать туда
 * реальный плеер порталом.
 *
 * Зачем: нативный Picture-in-Picture у <video> закрывается сам, как только
 * элемент убирают из документа — а именно так Next.js App Router и убирает
 * страницу при переходе (React размонтирует поддерево целиком). Если в
 * момент ухода со страницы PiP активен, держатель не даёт <video> покинуть
 * документ — просто перепортаlivает его в свой скрытый контейнер:
 * воспроизведение и плавающее окно продолжают жить, пока пользователь не
 * откроет ДРУГОЙ тайтл (тогда сессия закрывается по-настоящему) или сам не
 * закроет PiP.
 *
 * OwnPlayer при этом остаётся тем же самым React-инстансом (тот же key) —
 * меняется только контейнер портала, а не сам компонент, поэтому hls.js/
 * позиция/буфер не сбрасываются при переезде между dock'ами.
 */
export function PipPlayerHost({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const hiddenHostRef = useRef<HTMLDivElement | null>(null);
  const pipActiveRef = useRef(false);
  const ownerKeyRef = useRef<string | null>(null);

  const show = useCallback(
    (key: string, props: OwnPlayerProps, dockEl: HTMLDivElement) => {
      // eslint-disable-next-line no-console
      console.log(
        '[pip-debug] host.show', key, 'resumeFrom=', props.resumeFrom,
        'ownerKeyRef=', ownerKeyRef.current, 'dockEl===prevDock?',
      );
      if (ownerKeyRef.current && ownerKeyRef.current !== key) {
        // Открыли ДРУГОЙ тайтл, пока предыдущий ещё жив (обычно висел в
        // PiP, см. hide ниже) — прежняя сессия закрывается безусловно,
        // новый плеер получает video/hls с нуля, как и раньше.
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        }
        pipActiveRef.current = false;
      } else if (ownerKeyRef.current === key && pipActiveRef.current) {
        // Тот же тайтл, вернулись на страницу, пока он играл в PiP —
        // возвращаем видео на место, плавающее окно больше не нужно.
        document.exitPictureInPicture().catch(() => {});
      }
      ownerKeyRef.current = key;
      setDock(dockEl);
      setSession({ key, props });
    },
    [],
  );

  const hide = useCallback((key: string) => {
    if (ownerKeyRef.current !== key) return; // уже перехвачено другим тайтлом
    if (pipActiveRef.current && hiddenHostRef.current) {
      // PiP активен — не закрываем сессию, уводим портал в скрытый
      // контейнер держателя: <video> остаётся в документе, воспроизведение
      // и плавающее окно не прерываются.
      setDock(hiddenHostRef.current);
      return;
    }
    ownerKeyRef.current = null;
    setSession(null);
    setDock(null);
  }, []);

  const onPipChange = useCallback((active: boolean) => {
    pipActiveRef.current = active;
    // Пользователь закрыл плавающее окно вручную, пока плеер уже осиротел
    // (страница, которая его открыла, не смонтирована) — сессии больше
    // незачем жить дальше.
    if (!active && dock !== null && dock === hiddenHostRef.current) {
      ownerKeyRef.current = null;
      setSession(null);
      setDock(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock]);

  return (
    <PipHostContext.Provider value={{ show, hide }}>
      {children}
      {/* Всегда смонтированный скрытый контейнер — сюда уезжает портал,
          когда ни одна страница плеер не «докует», но PiP ещё активен. */}
      <div
        ref={hiddenHostRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: 0,
          right: 0,
          width: 1,
          height: 1,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      {session &&
        dock &&
        createPortal(
          <OwnPlayer key={session.key} {...session.props} onPipChange={onPipChange} />,
          dock,
        )}
    </PipHostContext.Provider>
  );
}
