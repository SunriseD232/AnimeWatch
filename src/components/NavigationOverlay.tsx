'use client';

/**
 * Полноэкранный лоадер на время клиентского перехода (useTransition) —
 * общий для мест, где нужно блокировать страницу вместо того, чтобы
 * оставлять старую кликабельной, пока грузится новая (см. ModeSwitch.tsx,
 * SiteLogoLink.tsx).
 */
export default function NavigationOverlay() {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
  );
}
