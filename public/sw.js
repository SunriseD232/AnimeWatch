// MediaWatch — минимальный service worker, только для установки как PWA
// («Добавить на экран»). Никакого кэширования видео/API/страниц: контент
// живой (прогресс просмотра, каталог), устаревший кэш сломал бы больше, чем
// дал бы пользы — единственная задача SW тут — само его наличие с
// fetch-обработчиком, которого требуют критерии установки в некоторых
// браузерах (Android WebAPK).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
