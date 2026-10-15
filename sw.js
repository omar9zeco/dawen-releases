/* Dawen service worker — offline shell + automatic updates */
const SW_VERSION = 'dawen-v1.5.0-pwa-4';
const STATIC_CACHE = `${SW_VERSION}-static`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

// Base URL derived from the SW's own location — works at '/' or '/dawen-releases/'.
const BASE = new URL(self.location).pathname.replace(/sw\.js$/, '');
const SHELL = BASE; // app shell (index.html)

const PRECACHE = [
  SHELL,
  `${BASE}manifest.webmanifest`,
  `${BASE}pwa-192.png`,
  `${BASE}pwa-512.png`,
  `${BASE}pwa-512-maskable.png`,
  `${BASE}apple-touch-icon.png`,
  `${BASE}favicon.png`,
  `${BASE}logo.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(SW_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return url.pathname.startsWith(`${BASE}assets/`) && /\.[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpg|svg|webp|ico)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets: cache-first (immutable).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Navigations / HTML: network-first so updates land immediately,
  // falling back to the cached shell when offline.
  // (GitHub Pages serves 404.html with status 404 for SPA deep links — cache it as shell.)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const ct = (response.headers.get('content-type') || '');
          if (response.ok || (response.status === 404 && ct.includes('text/html'))) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  // Everything else (icons, manifest, fonts, etc.): stale-while-revalidate.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: SW_VERSION });
  }
});
