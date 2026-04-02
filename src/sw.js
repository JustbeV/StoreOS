// ============================================================
// StoreOS Service Worker
// ============================================================

// Bump this version string whenever you deploy new code.
// The old SW will be replaced and old caches will be purged.
const SW_VERSION   = 'v1.0.0';
const CACHE_SHELL  = `storeOS-shell-${SW_VERSION}`;   // App shell (HTML, CSS, JS)
const CACHE_ASSETS = `storeOS-assets-${SW_VERSION}`;  // Images, fonts
const CACHE_FONTS  = `storeOS-fonts-${SW_VERSION}`;   // Google Fonts

// All known caches — anything NOT in this list gets deleted on activate
const ALL_CACHES = [CACHE_SHELL, CACHE_ASSETS, CACHE_FONTS];

// App shell files — cached immediately on install
const SHELL_FILES = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles/style.css',
  '/src/app.js',
  '/src/core/auth.js',
  '/src/core/router.js',
  '/src/features/products.js',
  '/src/features/sales.js',
  '/src/features/utang.js',
  '/src/utils/helpers.js',
  '/manifest.json',
];

// ============================================================
// INSTALL — pre-cache the app shell
// ============================================================
self.addEventListener('install', event => {
  console.log(`[SW ${SW_VERSION}] Installing...`);
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => {
        console.log(`[SW ${SW_VERSION}] Shell cached`);
        // Force this SW to become active immediately (don't wait for old tabs to close)
        return self.skipWaiting();
      })
      .catch(err => console.error('[SW] Shell cache failed:', err))
  );
});

// ============================================================
// ACTIVATE — clean up old caches from previous versions
// ============================================================
self.addEventListener('activate', event => {
  console.log(`[SW ${SW_VERSION}] Activating...`);
  event.waitUntil(
    caches.keys().then(keys => {
      const deletions = keys
        .filter(key => !ALL_CACHES.includes(key))
        .map(key => {
          console.log(`[SW] Deleting old cache: ${key}`);
          return caches.delete(key);
        });
      return Promise.all(deletions);
    }).then(() => {
      console.log(`[SW ${SW_VERSION}] Active — controlling all clients`);
      // Take over all open tabs immediately without reload
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH — route every request to the right strategy
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests — POST/PUT/DELETE go straight to network
  if (request.method !== 'GET') return;

  // ── 1. Firebase / Google APIs → always network, never cache ──
  if (isFirebaseRequest(url)) return;

  // ── 2. Google Fonts (CSS) → stale-while-revalidate ──
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // ── 3. Google Fonts (woff2 files) → cache-first, long TTL ──
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // ── 4. Product images (Firebase Storage) → cache-first ──
  if (url.hostname.includes('firebasestorage.googleapis.com')) {
    event.respondWith(cacheFirst(request, CACHE_ASSETS));
    return;
  }

  // ── 5. App shell files → network-first with shell fallback ──
  if (isShellFile(url)) {
    event.respondWith(networkFirstWithShellFallback(request));
    return;
  }

  // ── 6. Everything else → network-first, cache as backup ──
  event.respondWith(networkFirst(request));
});

// ============================================================
// BACKGROUND SYNC — flush offline sale queue when back online
// ============================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-offline-sales') {
    console.log('[SW] Background sync: flushing offline sales');
    event.waitUntil(flushOfflineSales());
  }
});

async function flushOfflineSales() {
  const queue = await readOfflineQueue();
  if (!queue || queue.length === 0) return;

  const successIds = [];
  for (const entry of queue) {
    try {
      // Notify the main page to process this queued sale
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(client => {
        client.postMessage({ type: 'PROCESS_OFFLINE_SALE', payload: entry });
      });
      successIds.push(entry.id);
    } catch (err) {
      console.warn('[SW] Could not flush sale', entry.id, err);
    }
  }

  if (successIds.length > 0) {
    await removeFromOfflineQueue(successIds);
    console.log(`[SW] Flushed ${successIds.length} offline sale(s)`);

    // Notify clients that sync is done
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => {
      client.postMessage({ type: 'OFFLINE_SYNC_COMPLETE', count: successIds.length });
    });
  }
}

// ============================================================
// MESSAGE HANDLER — app can send commands to the SW
// ============================================================
self.addEventListener('message', event => {
  const { type } = event.data || {};

  // App asks SW to update immediately (called after user confirms "new version available")
  if (type === 'SKIP_WAITING') {
    console.log('[SW] Skipping wait on request');
    self.skipWaiting();
  }

  // App asks SW to cache a specific URL on demand (e.g. a product image)
  if (type === 'CACHE_URL') {
    const { url } = event.data;
    if (url) {
      caches.open(CACHE_ASSETS)
        .then(cache => cache.add(url))
        .catch(e => console.warn('[SW] Could not cache URL:', url, e));
    }
  }

  // App asks SW to nuke all caches (e.g. after logout)
  if (type === 'CLEAR_CACHES') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => console.log('[SW] All caches cleared'));
  }

  // App registers a pending offline sale for background sync
  if (type === 'QUEUE_OFFLINE_SALE') {
    const { sale } = event.data;
    if (sale) {
      addToOfflineQueue(sale)
        .then(() => console.log('[SW] Offline sale queued:', sale.id))
        .catch(e => console.warn('[SW] Could not queue sale:', e));
    }
  }
});

// ============================================================
// CACHE STRATEGIES
// ============================================================

/**
 * Network-first with offline.html fallback.
 * Best for: app shell HTML pages.
 */
async function networkFirstWithShellFallback(request) {
  try {
    const response = await fetchAndCache(request, CACHE_SHELL);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}

/**
 * Network-first: try network, fall back to cache.
 * Best for: general content that should be fresh but has a usable stale version.
 */
async function networkFirst(request) {
  try {
    return await fetchAndCache(request, CACHE_ASSETS);
  } catch {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

/**
 * Cache-first: serve from cache if available, otherwise fetch and cache.
 * Best for: fonts, product images — things that are effectively immutable.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    return await fetchAndCache(request, cacheName);
  } catch {
    return Response.error();
  }
}

/**
 * Stale-while-revalidate: serve stale immediately, update in background.
 * Best for: Google Fonts CSS — users get fast load and fresh data next visit.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cached      = await caches.match(request);
  const revalidation = fetchAndCache(request, cacheName).catch(() => {});
  if (cached) {
    // Fire revalidation but don't wait
    revalidation;
    return cached;
  }
  return revalidation;
}

/**
 * Fetch a request and store a clone in the given cache.
 * Only caches successful GET responses. Never caches opaque responses.
 */
async function fetchAndCache(request, cacheName) {
  const response = await fetch(request);
  // response.type === 'opaque' means cross-origin no-cors — don't cache, size unknown
  if (response.ok && request.method === 'GET' && response.type !== 'opaque') {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

// ============================================================
// HELPERS
// ============================================================

function isFirebaseRequest(url) {
  return (
    url.hostname.includes('firestore.googleapis.com')       ||
    url.hostname.includes('firebase.googleapis.com')        ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')     ||
    url.hostname.includes('www.googleapis.com')             ||
    // Firebase JS SDK files from gstatic — browser handles their own caching
    (url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs'))
  );
}

function isShellFile(url) {
  const shellPaths = [
    '/',
    '/index.html',
    '/styles/style.css',
    '/src/app.js',
    '/src/core/auth.js',
    '/src/core/router.js',
    '/src/features/products.js',
    '/src/features/sales.js',
    '/src/features/utang.js',
    '/src/utils/helpers.js',
    '/manifest.json',
    '/offline.html'
  ];
  return shellPaths.includes(url.pathname);
}

// ============================================================
// INDEXEDDB — offline sale queue
// ============================================================
// Intentionally minimal — heavy business logic lives in app.js.
// The SW only reads/writes raw entries; app.js owns the schema.

const IDB_NAME    = 'storeOS-offline';
const IDB_VERSION = 1;
const IDB_STORE   = 'pendingSales';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function readOfflineQueue() {
  try {
    const db    = await openIDB();
    const tx    = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  } catch (e) {
    console.warn('[SW] readOfflineQueue failed:', e);
    return [];
  }
}

async function addToOfflineQueue(entry) {
  const db    = await openIDB();
  const tx    = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const req = store.put(entry);
    req.onsuccess = resolve;
    req.onerror   = e => reject(e.target.error);
  });
}

async function removeFromOfflineQueue(ids) {
  try {
    const db    = await openIDB();
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const id of ids) store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  } catch (e) {
    console.warn('[SW] removeFromOfflineQueue failed:', e);
  }
}
