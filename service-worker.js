const CACHE_NAME = "personalcrm-v2";

const APP_FILES = [
  "/CRM/",
  "/CRM/index.html",
  "/CRM/style.css",
  "/CRM/app.js",
  "/CRM/drive.js",
  "/CRM/manifest.json",
  "/CRM/icons/icon-192.png",
  "/CRM/icons/icon-512.png"
];

/* Установка */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});


/* Активация */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});


/* Запросы */
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /* Google API не кэшируем */
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("accounts.google.com")
  ) {
    return;
  }

  /*
    Для файлов приложения сначала пробуем сеть.
    Если сеть недоступна — берём кэш.
    Так обновления GitHub Pages появляются сразу.
  */
  event.respondWith(
    fetch(request)
      .then(response => {
        if (
          response &&
          response.status === 200 &&
          response.type !== "opaque"
        ) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });
        }

        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
