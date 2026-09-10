const CACHE_NAME = "personalcrm-v1";

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
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
  );

  self.skipWaiting();
});


/* Активация */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
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

  /*
    Google API и Google Login не кэшируем.
  */
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("accounts.google.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(request).then(response => {
        if (
          !response ||
          response.status !== 200 ||
          response.type === "opaque"
        ) {
          return response;
        }

        const copy = response.clone();

        caches
          .open(CACHE_NAME)
          .then(cache => {
            cache.put(request, copy);
          });

        return response;
      });
    })
  );
});
