// ============================================================================
// services/cache.js
// Read-through cache for GET-like (non-mutating) API calls. Lets the
// dashboard, entries list, and reports render last-known data when the
// device is offline, clearly marked as stale (see api.js `_stale` flag).
// ============================================================================
import { CacheStore } from './storage.js';
import { CACHEABLE_READS } from '../utils/constants.js';

function buildCacheKey(fn, args) {
  // Args are already JSON-serializable (crmId strings, plain filter
  // objects) so this is a stable, human-debuggable cache key.
  return `${fn}::${JSON.stringify(args)}`;
}

export function isCacheable(fn) {
  return CACHEABLE_READS.includes(fn);
}

export async function getCachedResponse(fn, args) {
  if (!isCacheable(fn)) return null;
  try {
    const row = await CacheStore.get(buildCacheKey(fn, args));
    return row ? row.value : null;
  } catch (e) {
    return null;
  }
}

export async function setCachedResponse(fn, args, value) {
  if (!isCacheable(fn)) return;
  try {
    await CacheStore.set(buildCacheKey(fn, args), value, fn, args);
  } catch (e) {
    // Storage quota exceeded or IndexedDB unavailable — caching is a nice-to-
    // have, never let a failure here surface to the user.
  }
}

export async function clearAllCached() {
  try { await CacheStore.clear(); } catch (e) {}
}
