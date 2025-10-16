/* Zpěvníček – Service Worker v1.6 (fix: songs -> DYNAMIC cache + broader lookup)
   - cache-first pro statiku (shell)
   - network-first pro HTML navigaci (s offline fallbackem)
   - stale-while-revalidate pro data a /songs/*
   - instalace: precache core do STATIC + všechny .pro ze /data/songs.json do DYNAMIC
*/
const VERSION = '2025-10-16-07';
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
    const cStatic = await caches.open(CACHE_STATIC);
    const cDyn    = await caches.open(CACHE_DYNAMIC);

    // 1) precache jádra – offline shell (STATIC)
    await cStatic.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' })));

    // 2) stáhni všechny písně podle "file" z /data/songs.json (ukládej do DYNAMIC)
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
                if (songRes.ok) await cDyn.put(r, songRes.clone()); // <<< DYNAMIC
              } catch { /* jedna chyba nevadí */ }
            }
          }
        }
      }
    } catch { /* songs.json chybí / chyba – nevadí */ }

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
  // Hledej napřed napříč VŠEMI cache (STATIC i DYNAMIC)
  const anyHit = await caches.match(req, { ignoreSearch: true });
  if (anyHit) {
    // paralelně se zkus aktualizovat
    fetch(req, { cache: 'no-store' })
      .then(async res => {
        if (res && res.ok) {
          const dyn = await caches.open(CACHE_DYNAMIC);
          dyn.put(req, res.clone());
        }
      })
      .catch(() => {});
    return anyHit;
  }

  // jinak network → ulož do DYNAMIC
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) {
      const dyn = await caches.open(CACHE_DYNAMIC);
      dyn.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

// Pomocník: absolutní cesta pro song.file
function toAbsoluteSongPath(u) {
  if (typeof u !== 'string') return null;
  let s = u.trim();
  if (!s) return null;

  if (s.startsWith(`${BASE}/`)) return s;         // už absolutní
  if (s.startsWith('/songs/')) return `${BASE}${s}`;
  if (s.startsWith('songs/'))  return `${BASE}/${s}`;
  return null;
}
