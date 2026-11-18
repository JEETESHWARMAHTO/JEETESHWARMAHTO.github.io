'use strict';

/* ============================================================
 * Contact Book service worker
 * ------------------------------------------------------------
 * - cache-first for build assets: /css, /js, /icons, manifest
 * - network-first for navigations (always fresh HTML online,
 *   shell from cache when offline)
 * - NEVER caches /api/* or the /__livereload event stream
 * - old caches are dropped on every version bump
 * ============================================================ */

const VERSION = '1';
const CACHE = `contact-book-v${VERSION}`;

/* precached shell - failures are tolerated so install never blocks */
const CORE = ['/', '/manifest.webmanifest', '/css/styles.css', '/js/shared.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/css/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* live data and the live-reload stream always go straight to the network */
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__livereload')) return;

  /* navigations: network first, offline fallback to the cached shell */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/').then((shell) => shell || Response.error()))
        )
    );
    return;
  }

  /* build assets: cache first, filled from the network on a miss */
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
});
