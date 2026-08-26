'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import OwnPlayer from '@/components/OwnPlayer';

type OwnPlayerProps = ComponentProps<typeof OwnPlayer>;

interface Session {
  key: string;
  props: OwnPlayerProps;
}

interface PipHostContextValue {
  /** Регистрирует/обновляет сессию «Нашего плеера» для тайтла key и её
   *  «причал» (dock) — куда визуально ставить плеер, пока страница
   *  просмотра смонтирована. Вызывается на каждом рендере страницы (см.
   *  Player.tsx/WatchPlayer.tsx). */
  show: (key: string, props: OwnPlayerProps, dock: HTMLDivElement, href: string) => void;
  /** Страница просмотра размонтировалась/ушла с вкладки «Наш плеер» — dock
   *  для key больше не действителен. Если для key сейчас активен
   *  Picture-in-Picture, сессия не закрывается: видео остаётся жить (просто
   *  без видимого причала), пока пользователь не вернётся на страницу с тем
   *  же key или не откроет другой тайтл. */
  unclaimDock: (key: string) => void;
}

const PipHostContext = createContext<PipHostContextValue | null>(null);

/** Безопасное «спрятанное» состояние постоянного контейнера — за экраном,
 *  непрозрачный (см. комментарий в rAF-цикле про то, почему НЕ opacity:0),
 *  но pointer-events:none, чтобы ничего не перехватывать под собой. */
function resetHolderOffscreen(holder: HTMLDivElement): void {
  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '-10000px';
  holder.style.width = '480px';
  holder.style.height = '270px';
  holder.style.opacity = '1';
  holder.style.pointerEvents = 'none';
}

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
 * (dock) и через show()/unclaimDock() сообщают ЭТОМУ компоненту, где сейчас
 * находится их «причал».
 *
 * Зачем вообще так: нативный Picture-in-Picture у <video> закрывается сам,
 * как только элемент убирают из документа — а именно так Next.js App Router
 * убирает страницу при переходе (React размонтирует поддерево целиком).
 *
 * КАК устроено (важно): реальный <video>/OwnPlayer порталится ВСЕГДА в один
 * и тот же, никогда не меняющийся DOM-узел (holderRef) — целевой контейнер
 * портала не меняется НИКОГДА, поэтому React никогда не имеет повода
 * пересоздать компонент. Раньше портал целился то в dock страницы, то в
 * скрытый контейнер — смена ЦЕЛИ портала на практике оказалась не «переносом
 * узла», а полным раскрытием/пересборкой поддерева (проверено вживую: смена
 * target уничтожала <video> и hls.js, currentTime улетал на 0) — то есть
 * ИМЕННО та проблема, которую вся эта архитектура должна была решить.
 *
 * Вместо переноса DOM-узла — постоянный контейнер держим как position:fixed
 * и на каждый кадр (rAF, пока есть активная сессия) подгоняем его
 * top/left/width/height под getBoundingClientRect() dock'а ТЕКУЩЕЙ
 * смонтированной страницы (если она есть и совпадает по key). Нет
 * подходящей страницы (ушли со страницы, PiP донашивает воспроизведение
 * фоном) — контейнер уезжает за экран, но не размонтируется.
 */
export function PipPlayerHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  // Состояние (не просто ref) — портал ниже читает его при рендере, а читать
  // ref.current прямо в рендере (не в эффекте/колбэке) при конкурентном
  // рендеринге React не гарантированно консистентно. once не-null, этот
  // holderEl уже не меняется до конца жизни приложения (див ниже рендерится
  // безусловно и никогда не размонтируется), так что колбэк отработает один раз.
  const [holderEl, setHolderEl] = useState<HTMLDivElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const dockElRef = useRef<HTMLDivElement | null>(null);
  // Адрес страницы просмотра для ТЕКУЩЕЙ сессии (см. show ниже) — сюда
  // возвращаемся, если пользователь закрыл плавающее окно вручную, пока
  // плеер был осиротевшим (см. onPipChange).
  const hrefRef = useRef<string | null>(null);
  const pipActiveRef = useRef(false);
  const ownerKeyRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const show = useCallback(
    (key: string, props: OwnPlayerProps, dockEl: HTMLDivElement, href: string) => {
      if (ownerKeyRef.current && ownerKeyRef.current !== key) {
        // Открыли ДРУГОЙ тайтл, пока предыдущий ещё жив (обычно висел в
        // PiP) — прежняя сессия закрывается безусловно, новый плеер
        // получает video/hls с нуля, как и раньше.
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
      dockElRef.current = dockEl;
      hrefRef.current = href;
      setSession((prev) => (prev && prev.key === key ? { key, props } : { key, props }));
    },
    [],
  );

  const unclaimDock = useCallback((key: string) => {
    if (ownerKeyRef.current !== key) return; // уже перехвачено другим тайтлом
    dockElRef.current = null;
    if (pipActiveRef.current) return; // PiP активен — сессия живёт дальше без видимого причала
    ownerKeyRef.current = null;
    setSession(null);
  }, []);

  const onPipChange = useCallback(
    (active: boolean) => {
      pipActiveRef.current = active;
      // Плавающее окно закрылось (крестиком или кнопкой «Вернуться на
      // вкладку»), а страница, которая открыла плеер, сейчас не смонтирована
      // (dock пуст) — возвращаем пользователя на страницу с этим плеером,
      // чтобы он не терял видео из виду. Сама страница при монтировании
      // снова вызовет show() с тем же key — сессия просто «заберёт» плеер
      // обратно, без пересоздания (см. show выше).
      if (!active && dockElRef.current === null) {
        if (hrefRef.current) {
          router.push(hrefRef.current);
        } else {
          ownerKeyRef.current = null;
          setSession(null);
        }
      }
    },
    [router],
  );

  // Каждый кадр, пока есть активная сессия, подгоняем позицию/размер
  // постоянного контейнера под текущий dock (если он есть и подключён к
  // документу) — либо уводим контейнер за экран, если dock'а сейчас нет.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    if (!session) {
      // Сессии нет — контейнер должен быть гарантированно спрятан. Раньше
      // тут был просто `return` без сброса стилей: rAF-цикл ниже двигает
      // holder ИМПЕРАТИВНО (holder.style.top = ...), в обход React, а сам
      // JSX-проп style={{...}} ни разу не меняется между рендерами (те же
      // литералы каждый раз) — React сравнивает со своей последней версией
      // этого не изменившегося объекта и ничего не переприменяет, то есть
      // НЕ возвращает стили к «безопасным», если последний реальный тик
      // застал контейнер поверх видео (top/left страницы, pointerEvents:
      // 'auto'). Если сессия обрывалась ИМЕННО на этом кадре (см. show/
      // unclaimDock), эти координаty так и оставались на элементе навсегда
      // — невидимый (aria-hidden) div с pointer-events:auto зависал ровно
      // там, где был плеер, и перехватывал клики (воспроизведено вживую на
      // /cinema/322). Принудительно возвращаем «спрятанное» состояние.
      resetHolderOffscreen(holder);
      return;
    }

    const tick = () => {
      const dock = dockElRef.current;
      if (dock && dock.isConnected) {
        const r = dock.getBoundingClientRect();
        holder.style.position = 'fixed';
        holder.style.top = `${r.top}px`;
        holder.style.left = `${r.left}px`;
        holder.style.width = `${r.width}px`;
        holder.style.height = `${r.height}px`;
        holder.style.opacity = '1';
        holder.style.pointerEvents = 'auto';
      } else {
        // Ни одна страница сейчас не «докует» плеер (ушли со страницы, PiP
        // донашивает воспроизведение фоном) — уводим контейнер ЗА ЭКРАН, а
        // НЕ схлопываем его в 1×1px/opacity:0. Проверено вживую: схлопывание
        // до почти нулевого размера/прозрачности заставляло реальный
        // Picture-in-Picture в браузере закрываться самостоятельно (видимо,
        // Chrome трактует это похоже на display:none, хотя формально это не
        // он) — с нормальным размером и полной непрозрачностью, просто вне
        // видимой области, плавающее окно продолжает работать корректно.
        resetHolderOffscreen(holder);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [session]);

  // Мемоизировано намеренно: show/unclaimDock сами стабильны (useCallback
  // без зависимостей), но без useMemo этот объект пересоздавался бы на
  // каждый рендер PipPlayerHost — а значит менялся бы у контекста, а значит
  // любой потребитель (Player.tsx/WatchPlayer.tsx) перерендеривался бы
  // просто от смены ссылки на объект. Раньше это давало настоящий
  // бесконечный цикл: Player.tsx рендерится → эффект без deps зовёт show() →
  // setSession здесь → PipPlayerHost рендерится → НОВЫЙ объект контекста →
  // Player.tsx снова рендерится (просто потому что подписан на контекст) →
  // снова show() → ... без остановки, десятки раз в секунду сам по себе.
  const contextValue = useMemo(() => ({ show, unclaimDock }), [show, unclaimDock]);

  return (
    <PipHostContext.Provider value={contextValue}>
      {children}
      {/* Единственный, НИКОГДА не меняющийся контейнер портала — см. большой
          комментарий выше про то, почему нельзя было переключать target. */}
      <div
        ref={(el) => {
          holderRef.current = el;
          setHolderEl(el);
        }}
        aria-hidden={!session}
        style={{
          // Начальные значения — те же, что и «нет причала» ветка rAF-цикла
          // ниже (полный непрозрачный размер, просто за экраном): реальный
          // размер/непрозрачность важны, чтобы браузер не решил, что видео
          // «пропало», и не закрыл настоящий Picture-in-Picture сам (см.
          // комментарий в rAF-цикле).
          position: 'fixed',
          top: 0,
          left: -10000,
          width: 480,
          height: 270,
          overflow: 'hidden',
          opacity: 1,
          pointerEvents: 'none',
          zIndex: 30,
        }}
      >
        {session &&
          holderEl &&
          createPortal(
            <OwnPlayer key={session.key} {...session.props} onPipChange={onPipChange} />,
            holderEl,
          )}
      </div>
    </PipHostContext.Provider>
  );
}
