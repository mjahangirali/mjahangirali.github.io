// ============================================================================
// service-worker.js
// Plain script (not an ES module) — Background Sync and wide Safari/Firefox
// support for service workers is far more reliable without `type: 'module'`,
// so the constants below are duplicated as literals rather than imported
// from utils/constants.js. Keep these in sync with that file if you change
// either one.
// ============================================================================

const SHELL_CACHE = 'nsms-shell-v1';
const RUNTIME_CACHE = 'nsms-runtime-v1';
const API_HOST = 'script.google.com'; // matches API_BASE_URL's host — never cached, never intercepted for retry logic here (app-level sync.js owns that path while a page is open)

const DB_NAME = 'nsms_offline_db';
const DB_VERSION = 1;
const STORE_MUTATION_QUEUE = 'mutation_queue';
const SYNC_TAG = 'nsms-sync-mutations';
const SYNC_STATUS = { PENDING: 'pending', SYNCING: 'syncing', SYNCED: 'synced', FAILED: 'failed' };
const SYNC_MAX_ATTEMPTS = 8;

// Core app shell — precached on install so the UI can render fully offline.
// Update this list if you rename/move any top-level file.
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './main.js',
  './styles/app.css',
  './styles/shell.css',
  './styles/dashboard.css',
  './styles/login.css',
  './styles/wizard.css',
  './styles/entries.css',
  './styles/reports.css',
  './styles/profile.css',
  './utils/constants.js',
  './utils/helpers.js',
  './services/transport.js',
  './services/storage.js',
  './services/cache.js',
  './services/sync.js',
  './services/api.js',
  './services/auth.js',
  './services/pwa-installer.js',
  './components/bottomnav.js',
  './components/topbar.js',
  './components/loader.js',
  './components/toast.js',
  './components/charts.js',
  './pages/login.js',
  './pages/dashboard.js',
  './pages/reports.js',
  './pages/profile.js',
  './pages/entries.js',
  './pages/wizard.js',
  './pages/targets.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

// ---------------------------------------------------------------------------
// Install / Activate
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      // Don't fail the whole install if one optional shell file 404s (e.g. a
      // page not built yet) — cache what we can, log the rest.
      .catch((err) => console.warn('[SW] Shell precache partial failure:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Lets the page force an update after showing "New version available" (see
// pwa-installer.js) instead of waiting for the next full reload cycle.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'NSMS_MANUAL_SYNC') {
    event.waitUntil(flushMutationQueue());
  }
});

// ---------------------------------------------------------------------------
// Fetch — routing by request type
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept calls to the Apps Script API — they must always hit the
  // network live so success/failure is reported to api.js immediately. The
  // offline queue (services/sync.js) is what handles failures for these.
  if (url.host === API_HOST) return;

  // Only handle same-origin GET requests below; anything else falls through
  // to default browser handling.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|ico|json)$/.test(pathname);
}

async function networkFirstNavigation(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request) || await cache.match('./index.html');
    return cached || cache.match('./offline.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || networkFetch || Response.error();
}

// ---------------------------------------------------------------------------
// Background Sync — flushes the offline mutation queue even with no page
// open. Mirrors services/sync.js's retry semantics but reads/writes
// IndexedDB directly since a service worker can't rely on a live page.
// ---------------------------------------------------------------------------

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushMutationQueue());
  }
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // No onupgradeneeded here deliberately — the page (services/storage.js)
    // owns schema creation. If the SW runs first with no DB yet, there's
    // nothing queued to sync anyway.
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPendingRecords(db) {
  const tx = db.transaction(STORE_MUTATION_QUEUE, 'readonly');
  const store = tx.objectStore(STORE_MUTATION_QUEUE);
  const index = store.index('status');
  return idbRequest(index.getAll(SYNC_STATUS.PENDING));
}

async function putRecord(db, record) {
  const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
  tx.objectStore(STORE_MUTATION_QUEUE).put(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRecord(db, clientId) {
  const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
  tx.objectStore(STORE_MUTATION_QUEUE).delete(clientId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function postToApi(fn, args, clientId) {
  // API_BASE_URL isn't available as an import here (plain script) — read it
  // from a value the page stashes via MetaStore at startup so this file
  // doesn't need a second place to edit when the deployment URL changes.
  const db = await openDb();
  const metaTx = db.transaction('meta', 'readonly');
  const metaRow = await idbRequest(metaTx.objectStore('meta').get('apiBaseUrl'));
  const apiBaseUrl = metaRow && metaRow.value;
  if (!apiBaseUrl) throw new Error('API base URL not yet initialized by the page.');

  const res = await fetch(apiBaseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args, clientId })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.error) {
    const err = new Error(data.msg || data.error);
    err.retryable = false;
    throw err;
  }
  return data;
}

async function flushMutationQueue() {
  let db;
  try {
    db = await openDb();
  } catch (e) {
    return; // no DB yet — nothing to do
  }

  const pending = await getPendingRecords(db).catch(() => []);
  let anySynced = false;

  for (const record of pending) {
    try {
      await postToApi(record.fn, record.args, record.clientId);
      await deleteRecord(db, record.clientId);
      anySynced = true;
    } catch (err) {
      const attempts = (record.attempts || 0) + 1;
      const retryable = err.retryable !== false;
      await putRecord(db, {
        ...record,
        attempts,
        status: (!retryable || attempts >= SYNC_MAX_ATTEMPTS) ? SYNC_STATUS.FAILED : SYNC_STATUS.PENDING,
        lastError: err.message
      });
    }
  }

  if (anySynced) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'NSMS_SYNC_TRIGGER' }));
  }
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
// The receiving/display side is fully wired below. What's NOT included here
// because it lives outside this Apps Script project: a push subscription
// endpoint (store PushSubscription objects somewhere queryable) and a
// sender that POSTs Web Push messages with VAPID keys — Apps Script alone
// can't send raw Web Push. Wire that up server-side (a small Cloud Function
// or similar) before enabling push in production; until then this handler
// simply won't receive anything.

self.addEventListener('push', (event) => {
  let payload = { title: 'NSMS', body: 'You have a new notification.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-96.png',
      data: { url: payload.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
