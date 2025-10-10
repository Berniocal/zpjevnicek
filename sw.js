/* Zpěvníček – Service Worker v1.1 (auto-update)
   - cache-first pro statiku (shell)
   - network-first pro HTML navigaci (s offline fallbackem)
   - stale-while-revalidate pro data/songs.json a /songs/*
   - auto-update: skipWaiting + message handler
*/
const VERSION = '2025-10-08-16';
const CACHE_STATIC  = `zpj-static-${VERSION}`;
const CACHE_DYNAMIC = `zpj-dyn-${VERSION}`;

// VŠECHNY cesty ABSOLUTNĚ pod /zpjevnicek/
const CORE_ASSETS = [
  '/zpjevnicek/',
  '/zpjevnicek/index.html',
  '/zpjevnicek/song.html',
  '/zpjevnicek/admin.html',
  '/zpjevnicek/assets/style.css',
  '/zpjevnicek/manifest.webmanifest',
  '/zpjevnicek/assets/icons/icon-192.png',
  '/zpjevnicek/assets/icons/icon-512.png',
  '/zpjevnicek/assets/icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_STATIC);
    // „měkké“ precache – když něco selže, instalace stejně proběhne
    await Promise.all(CORE_ASSETS.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { cache: 'reload' }));
        if (res.ok) await c.put(u, res.clone());
      } catch {}
    }));
    self.skipWaiting(); // ← klíč k auto-updatu
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// UI může přepnout na novou verzi okamžitě
self.addEventListener('message', (e) => {
  if (e?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Obsluhujeme jen vlastní origin a jen cestu /zpjevnicek/**
  if (url.origin !== location.origin || !url.pathname.startsWith('/zpjevnicek/')) return;

  const path = url.pathname;

  // Data a písně → stale-while-revalidate
  if (path === '/zpjevnicek/data/songs.json' || path.startsWith('/zpjevnicek/songs/')) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // HTML navigace → network-first s fallbackem na cache (index)
  if (req.mode === 'navigate' || path.endsWith('.html')) {
    e.respondWith(networkFirstHTML(req));
    return;
  }

  // Ostatní statika → cache-first
  e.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_STATIC);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstHTML(req) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cache.put('/zpjevnicek/index.html', res.clone());
    return res;
  } catch {
    // offline fallback
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match('/zpjevnicek/index.html')) ||
           Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const hit = await cache.match(req, { ignoreSearch: true });

  const fetching = fetch(req, { cache: 'no-store' })
    .then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  return hit || fetching || new Response('', { status: 504 });
}
