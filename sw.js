/* Zpěvníček – Service Worker v1.3 (auto-update + offline songs)
   - cache-first pro statiku (shell)
   - network-first pro HTML navigaci (s offline fallbackem)
   - stale-while-revalidate pro data a /songs/*
   - instalace: precache core + (volitelně) všechny /songs z /data/songs.json
*/
const VERSION = '2025-10-16-02';
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
  '/zpjevnicek/assets/icons/maskable-512.png',
  // pokusíme se přivést i seznam písní (pokud existuje)
  '/zpjevnicek/data/songs.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_STATIC);

    // ÚPRAVA #1: pevné precache – stáhne vše potřebné pro offline shell
    await c.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' })));

    // === EXTRA: Precache všech písní podle manifestu /data/songs.json (pokud existuje) ===
    try {
      const res = await fetch('/zpjevnicek/data/songs.json', { cache: 'reload' });
      if (res.ok) {
        const list = await res.json(); // očekává se pole absolutních cest
        if (Array.isArray(list) && list.length) {
          // jen HTML ze /songs/
          const songRequests = list
            .filter(u => typeof u === 'string' && u.startsWith('/zpjevnicek/songs/') && u.endsWith('.html'))
            .map(u => new Request(u, { cache: 'reload' }));
          if (songRequests.length) {
            await c.addAll(songRequests);
          }
        }
      }
    } catch (err) {
      // pokud seznam není/selže, appka bude mít písně po prvním otevření (SWR níže)
      // záměrně ticho
    }

    self.skipWaiting(); // auto-update
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

    if (res && res.ok) {
      // ÚPRAVA #2: ulož jak shell, tak i konkrétní HTML odpověď
      cache.put('/zpjevnicek/index.html', res.clone());
      cache.put(req, res.clone());
    }

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