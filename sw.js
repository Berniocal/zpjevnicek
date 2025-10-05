/* Zpjěvníček – Service Worker v1.0
   - cache-first pro statiku (shell)
   - network-first pro HTML navigaci (s offline fallbackem)
   - stale-while-revalidate pro data/songs.json a songs/* (rychlé + průběžná aktualizace)
*/
const CACHE_STATIC = 'zpj-static-v1';
const CACHE_DYNAMIC = 'zpj-dyn-v1';

const CORE_ASSETS = [
  'index.html',
  'song.html',
  'admin.html',
  'assets/style.css',
  'manifest.webmanifest',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  const path = url.pathname;

  // Data a písně → stale-while-revalidate
  if (path.endsWith('/data/songs.json') || path.includes('/songs/')) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // HTML navigace → network-first s fallbackem na cache
  const isHTMLNav = req.mode === 'navigate' || path.endsWith('.html') || path === '/' || path === '';
  if (isHTMLNav) {
    e.respondWith(networkFirst(req));
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
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return cache.match('index.html');
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req, { cache: 'no-store' })
    .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || net || new Response('', { status: 504 });
}
