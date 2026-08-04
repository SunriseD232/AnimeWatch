'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'info' | 'error' | 'success';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, message, kind }]);
      // Ошибки не закрываются сами — реальный сбой (не просто "ок,
      // готово") заслуживает того, чтобы пользователь успел прочитать и
      // закрыл вручную, а не гадал, что вообще произошло, если моргнул.
      if (kind !== 'error') {
        setTimeout(() => dismiss(id), 4500);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={[
              'flex items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ring-1 ring-white/10 backdrop-blur',
              t.kind === 'error'
                ? 'bg-red-950/90 text-red-100'
                : t.kind === 'success'
                  ? 'bg-emerald-950/90 text-emerald-100'
                  : 'bg-bg-card/95 text-gray-100',
            ].join(' ')}
          >
            <span className="flex-1">{t.message}</span>
            {t.kind === 'error' && (
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Закрыть уведомление"
                className="press -m-1 shrink-0 rounded p-1 text-red-200 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
