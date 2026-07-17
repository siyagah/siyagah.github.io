/* Siyagah Service Worker — network-first, self-updating.
   Cache name carries the app version; bump VERSION on every deploy.
   Network-first for the HTML document means you ALWAYS get the latest
   code when online, with the cached copy used only as an offline fallback.
   skipWaiting + clients.claim make a new worker take over immediately,
   and old caches are purged on activate — so you can never get pinned
   to a stale build again.

   v03.01.04 fix — added a same-origin guard in the fetch handler. Firestore's
   real-time Listen/Write channel connections (to firestore.googleapis.com)
   were falling through to the generic stale-while-revalidate path below,
   which tried to cache.put() them like any other asset. Those connections
   are long-lived streams, not normal cacheable responses — caching them
   throws inside the service worker ("A ServiceWorker intercepted the
   request and encountered an unexpected error"), which killed the
   real-time connection and forced Firestore into backoff, stalling sync
   across devices. Cross-origin requests (Firestore, Firebase SDK loads
   from gstatic.com, Google Auth, etc.) now bypass the service worker
   entirely and go straight to the network, same as a page with no
   service worker at all would handle them. */
const VERSION = 'v03.01.04';
const CACHE   = 'siyagah-' + VERSION;
const CORE    = ['./', './index.html', './manifest.json'];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {}))
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Never intercept cross-origin traffic — this SW only exists to cache
  // Siyagah's own files. Firestore's real-time streaming connections
  // (and Firebase SDK loads, Google Auth, etc.) must reach the network
  // completely untouched, or the browser's own default handling breaks.
  if (new URL(req.url).origin !== self.location.origin) return;
  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    // Network-first: fresh code whenever online; cache only as offline fallback.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('./index.html'))
        )
    );
    return;
  }
  // Everything else (same-origin only): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
