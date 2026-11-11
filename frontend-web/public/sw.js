/* Service Worker PWA — FashionStore SaaS Offline-First */
const CACHE_SHELL = 'fashionstore-shell-v2';
const CACHE_ASSETS = 'fashionstore-assets-v2';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
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
            .filter((k) => k !== CACHE_SHELL && k !== CACHE_ASSETS)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache-first para imagenes de prendas y assets estaticos
  if (url.pathname.startsWith('/assets/prendas/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE_ASSETS).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached || new Response('', { status: 504 });
        }
      }),
    );
    return;
  }

  // Network-first con fallback a cache para lecturas GET de API de catalogo y sync
  if (url.pathname.includes('/catalogo/') || url.pathname.includes('/sync/pull')) {
    event.respondWith(
      caches.open(CACHE_ASSETS).then(async (cache) => {
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.status === 200) {
            cache.put(request, netRes.clone());
          }
          return netRes;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ offline: true, error: 'MODO_OFFLINE_ACTIVO' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }),
    );
    return;
  }

  // Cache-first para assets estaticos del build (JS, CSS, imagenes, fuentes, iconos).
  // SIN esta regla el bundle /assets/*.js no se cachea y la PWA abre en blanco sin red.
  if (
    url.origin === self.location.origin &&
    /\.(?:js|css|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|webmanifest)$/.test(url.pathname) &&
    !url.pathname.startsWith('/api/')
  ) {
    event.respondWith(
      caches.open(CACHE_ASSETS).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.status === 200) {
            cache.put(request, netRes.clone());
          }
          return netRes;
        } catch {
          return cached || new Response('', { status: 504 });
        }
      }),
    );
    return;
  }

  // Navegacion SPA: devolver index.html si no hay red
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_SHELL);
        return (await cache.match('/index.html')) || (await cache.match('/'));
      }),
    );
  }
});
