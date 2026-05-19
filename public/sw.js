// Anchor PWA Service Worker
// Strategy: cache-first for static assets, network-first with offline fallback for navigation.

const CACHE = 'anchor-v1';
const OFFLINE_URL = '/';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Never intercept API routes or Firebase calls
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (hashed filenames) — cache-first, update in background
  if (url.pathname.startsWith('/static/') || url.pathname.endsWith('.png') || url.pathname === '/manifest.json') {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Navigation — network-first, serve cached shell when offline
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(OFFLINE_URL, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
  }
});
