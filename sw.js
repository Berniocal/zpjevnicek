/* Zpěvníček – Service Worker v1.5 (offline .pro songs precache)
   - cache-first pro statiku (shell)
   - network-first pro HTML navigaci (s offline fallbackem)
   - stale-while-revalidate pro data a /songs/*
   - instalace: precache core + robustní precache všech .pro souborů ze /data/songs.json
*/
const VERSION = '2025-10-16-05';
const CACHE_STATIC  = `zpj-static-${VERSION}`;
const CACHE_DYNAMIC = `zpj-dyn-${VERSION}`;
const BASE = '/zpjevnicek';

const CORE_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/song.html`,
  `${BASE}/admin.html`,
  `${BASE}/assets/style.css`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/assets/icons/icon-192.png`,
  `${BASE}/assets/icons/icon-512.png`,
  `${BASE}/assets/icons/maskable-512.png`,
  `${BASE}/data/songs.json`
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_STATIC);

    // 1) precache jádra – offline shell
    await c.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' })));

    // 2) pokus o stažení všech písní podle "file" z /data/songs.json
    try {
      const res = await fetch(`${BASE}/data/songs.json`, { cache: 'reload' });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          for (const song of list) {
            if (song?.file && typeof song.file === 'string') {
              const abs = toAbsoluteSongPath(song.file);
              if (!abs) continue;
              try {
                const r = new Request(abs, { cache: 'reload' });
                const songRes = await fetch(r);
                if (songRes.ok) await c.put(r, songRes.clone());
              } catch { /* jedna chyba nevadí */ }
            }
          }
        }
      }
    } catch {
      // songs.json chybí nebo nelze načíst – nevadí, SWR se postará při běhu
    }

    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k))
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(`${BASE}/`)) return;

  const path = url.pathname;

  // Data a písně (.pro) → stale-while-revalidate
  if (path === `${BASE}/data/songs.json` || path.startsWith(`${BASE}/songs/`)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // HTML navigace → network-first
  if (req.mode === 'navigate' || path.endsWith('.html')) {
    e.respondWith(networkFirstHTML(req));
    return;
  }

  // Ostatní → cache-first
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
      cache.put(`${BASE}/index.html`, res.clone());
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match(`${BASE}/index.html`)) ||
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

// Pomocník: vytvoří absolutní cestu pro song.file (podporuje relativní i absolutní zápisy)
function toAbsoluteSongPath(u) {
  if (typeof u !== 'string') return null;
  let s = u.trim();
  if (!s) return null;

  // pokud už je absolutní cesta pod /zpjevnicek/
  if (s.startsWith(`${BASE}/`)) return s;

  // pokud začíná "/songs/" → doplň prefix
  if (s.startsWith('/songs/')) return `${BASE}${s}`;

  // pokud začíná "songs/" → doplň prefix
  if (s.startsWith('songs/')) return `${BASE}/${s}`;

  return null;
}