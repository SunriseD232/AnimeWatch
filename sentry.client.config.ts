// MediaWatch — клиентская инициализация Sentry.
// Без NEXT_PUBLIC_SENTRY_DSN в .env SDK просто ничего никуда не шлёт — можно
// держать этот файл в репозитории независимо от того, подключён ли Sentry
// на конкретном окружении (см. README/деплой про SENTRY_DSN).
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Меньше шума от размонтированных страниц/расширений браузера.
  ignoreErrors: ['ResizeObserver loop limit exceeded'],
});
