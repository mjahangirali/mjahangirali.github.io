// ============================================================================
// services/storage.js
// Thin promise-based IndexedDB wrapper. No other module should call
// indexedDB directly — everything goes through here so the schema only
// lives in one place.
// ============================================================================
import {
  DB_NAME, DB_VERSION,
  STORE_MUTATION_QUEUE, STORE_RESPONSE_CACHE, STORE_META
} from '../utils/constants.js';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_MUTATION_QUEUE)) {
        const store = db.createObjectStore(STORE_MUTATION_QUEUE, { keyPath: 'clientId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_RESPONSE_CACHE)) {
        db.createObjectStore(STORE_RESPONSE_CACHE, { keyPath: 'cacheKey' });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab.'));
  });
  return _dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Generic CRUD ----------

export async function put(storeName, value) {
  const db = await openDb();
  return promisifyRequest(tx(db, storeName, 'readwrite').put(value));
}

export async function get(storeName, key) {
  const db = await openDb();
  return promisifyRequest(tx(db, storeName, 'readonly').get(key));
}

export async function del(storeName, key) {
  const db = await openDb();
  return promisifyRequest(tx(db, storeName, 'readwrite').delete(key));
}

export async function getAll(storeName) {
  const db = await openDb();
  return promisifyRequest(tx(db, storeName, 'readonly').getAll());
}

export async function getAllByIndex(storeName, indexName, value) {
  const db = await openDb();
  const store = tx(db, storeName, 'readonly');
  return promisifyRequest(store.index(indexName).getAll(value));
}

export async function clearStore(storeName) {
  const db = await openDb();
  return promisifyRequest(tx(db, storeName, 'readwrite').clear());
}

// ---------- Store-specific convenience exports ----------

export const QueueStore = {
  add: (record) => put(STORE_MUTATION_QUEUE, record),
  update: (record) => put(STORE_MUTATION_QUEUE, record),
  remove: (clientId) => del(STORE_MUTATION_QUEUE, clientId),
  get: (clientId) => get(STORE_MUTATION_QUEUE, clientId),
  all: () => getAll(STORE_MUTATION_QUEUE),
  byStatus: (status) => getAllByIndex(STORE_MUTATION_QUEUE, 'status', status)
};

export const CacheStore = {
  set: (cacheKey, value, fn, args) => put(STORE_RESPONSE_CACHE, {
    cacheKey, value, fn, args, storedAt: Date.now()
  }),
  get: (cacheKey) => get(STORE_RESPONSE_CACHE, cacheKey),
  clear: () => clearStore(STORE_RESPONSE_CACHE)
};

export const MetaStore = {
  set: (key, value) => put(STORE_META, { key, value }),
  get: async (key) => {
    const row = await get(STORE_META, key);
    return row ? row.value : undefined;
  }
};
