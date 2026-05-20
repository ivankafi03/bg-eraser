

const CACHE_NAME = 'decone-eraser-v13';
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// Install: pre-cache shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for JS/CDN, cache-first for shell
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // CDN resources (AI model weights etc.) — network only, don't cache (too large)
  if (url.hostname.includes('cdn.jsdelivr.net') || url.pathname.includes('.onnx') || url.pathname.includes('.wasm')) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell — cache first, then network (ignoring query strings for versioned assets)
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(err => {
        // Only return index.html fallback for navigation/page document requests
        if (request.mode === 'navigate' || request.destination === 'document') {
          return caches.match('./index.html');
        }
        throw err;
      });
    })
  );
});
