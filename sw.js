/* Zpěvníček – Service Worker v2.0 (offline fix)
   - STATIC = verziované jen pro shell
   - DYNAMIC = neverziované (zůstává mezi deployi), drží /songs/* a data
   - HTML navigace: network-first + fallback
   - /data/songs.json: stale-while-revalidate
   - /songs/*: cache-first (offline-ready)
   - Volitelně: hromadné stažení všech písní přes postMessage {type:'CACHE_ALL_SONGS'}
*/
const VERSION = '2025-10-26-87';
const CACHE_STATIC  = `zpj-static-${VERSION}`; // mění se při deployi
const CACHE_DYNAMIC = `zpj-dyn-v1`;            // STÁLÉ, NEMĚNIT KVŮLI UDRŽENÍ OFFLINE OBSAHU
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
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cStatic = await caches.open(CACHE_STATIC);
    await cStatic.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' })));
    // Pozn.: Nezatahujeme všechny /songs/* v install – to může timeoutovat.
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => {
        const isStatic = k.startsWith('zpj-static-');
        const isCurrentStatic = k === CACHE_STATIC;
        if (isStatic && !isCurrentStatic) return caches.delete(k);
        return Promise.resolve(false);
      })
    );
    // 🧹 zruš případnou statickou kopii seznamu
    try {
      const cStatic = await caches.open(CACHE_STATIC);
      await cStatic.delete(`${BASE}/data/songs.json`, { ignoreSearch: true });
    } catch {}
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});


self.addEventListener('message', (e) => {
  const msg = e?.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'CACHE_ALL_SONGS') {
    // hromadné stažení všech písní – neběží v install/activate, takže nehrozí timeout instalace
    e.waitUntil(cacheAllSongs(msg?.chunkSize || 8, msg?.reportProgress));
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // cizí domény neřešíme

  const path = url.pathname;

  // data & přehled
  if (path === `${BASE}/data/songs.json`) {
    e.respondWith(networkFirstJSON(req));
    return;
  }

  // všechny song soubory pod /zpjevnicek/songs/
  if (path.startsWith(`${BASE}/songs/`)) {
    e.respondWith(cacheFirstDynamic(req));
    return;
  }

  // HTML navigace
  if (req.mode === 'navigate' || path.endsWith('.html') || path === `${BASE}/`) {
    e.respondWith(networkFirstHTML(req));
    return;
  }

  // ostatní statika
  e.respondWith(cacheFirstStatic(req));
});

// ---------- strategie ----------
async function cacheFirstStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function cacheFirstDynamic(req) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  // první on-line načtení → uložit do DYNAMIC
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstHTML(req) {
  const cStatic = await caches.open(CACHE_STATIC);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cStatic.put(req, res.clone());
    return res;
  } catch {
    return (await cStatic.match(req, { ignoreSearch: true })) ||
           (await cStatic.match(`${BASE}/index.html`)) ||
           Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  const fetchAndPut = async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res && res.ok) {
        const dyn = await caches.open(CACHE_DYNAMIC);
        dyn.put(req, res.clone());
      }
    } catch {}
  };
  if (hit) { fetchAndPut(); return hit; }
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

async function networkFirstJSON(req) {
  const dyn = await caches.open(CACHE_DYNAMIC);
  try {
    // 🟢 Nejprve zkus síť (žádná cache)
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) {
      dyn.put(req, res.clone());
      console.log('[SW] songs.json aktualizován z internetu');
    }
    return res;
  } catch (err) {
    // 🔴 Když nejsme online → použij poslední uloženou verzi
    const cached = await dyn.match(req, { ignoreSearch: true });
    if (cached) {
      console.log('[SW] songs.json načten z cache');
      return cached;
    }
    // 🟠 Žádná cache → vrať prázdné pole
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}


// ---------- pomocné ----------
async function cacheAllSongs(chunkSize = 8, reportProgress = false) {
  // stáhni seznam
  const listRes = await fetch(`${BASE}/data/songs.json`, { cache: 'reload' });
  if (!listRes.ok) return;
  const list = await listRes.json();
  const dyn = await caches.open(CACHE_DYNAMIC);

  const files = (Array.isArray(list) ? list : [])
    .map(s => toAbsoluteSongPath(s?.file))
    .filter(Boolean);

  let done = 0;
  for (let i = 0; i < files.length; i += chunkSize) {
    const batch = files.slice(i, i + chunkSize);
    await Promise.all(batch.map(async (abs) => {
      try {
        const r = new Request(abs, { cache: 'reload' });
        const res = await fetch(r);
        if (res.ok) await dyn.put(r, res.clone());
      } catch {}
      done++;
    }));
    // uvolni event loop
    await delay(0);
    if (reportProgress) postProgress(done, files.length);
  }
  if (reportProgress) postProgress(files.length, files.length);
}

function toAbsoluteSongPath(u) {
  if (typeof u !== 'string') return null;
  let s = u.trim();
  if (!s) return null;
  if (s.startsWith(`${BASE}/`)) return s;     // už absolutní
  if (s.startsWith('/songs/')) return `${BASE}${s}`;
  if (s.startsWith('songs/'))  return `${BASE}/${s}`;
  return null;
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function postProgress(done, total) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clientsList) {
    c.postMessage({ type: 'CACHE_PROGRESS', done, total });
  }
}
