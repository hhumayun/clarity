/* Clarity Notes service worker.
   Caches the app shell so the installed app can open offline.
   Never caches /_api or Clerk — notes and auth always go to the network. */

const CACHE = "clarity-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNetworkOnly(url) {
  return (
    url.pathname.startsWith("/_api") ||
    url.hostname.endsWith("clerk.com") ||
    url.hostname.endsWith("clerk.accounts.dev") ||
    url.hostname.includes("clerk.")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (isNetworkOnly(url)) return;

  // Built assets are content-hashed: serve from cache when we have them.
  if (url.origin === self.location.origin && url.pathname.startsWith("/_assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Navigations and same-origin pages: network first, fall back to the shell.
  if (request.mode === "navigate" || url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/index.html")),
        ),
    );
  }
});
