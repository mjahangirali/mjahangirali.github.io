// ============================================================================
// services/sync.js
// Offline-first mutation queue. Every write (submitEntry, deleteEntry, etc.)
// that can't reach the server immediately is persisted here and retried
// with exponential backoff — via the Background Sync API when supported,
// and via 'online' events / a safety-net interval everywhere else (iOS
// Safari has no Background Sync API as of this writing).
// ============================================================================
import { QueueStore } from './storage.js';
import { rawCall, ApiError } from './transport.js';
import { uuid } from '../utils/helpers.js';
import {
  SYNC_TAG, SYNC_STATUS, SYNC_RETRY_BASE_MS, SYNC_RETRY_MAX_MS, SYNC_MAX_ATTEMPTS
} from '../utils/constants.js';

// UI (toast.js, an entries-list row, a header sync pill) subscribes to this
// instead of polling IndexedDB on a timer.
export const syncEvents = new EventTarget();

function emit(type, detail) {
  syncEvents.dispatchEvent(new CustomEvent(type, { detail }));
}

let _flushing = false;
let _fallbackTimer = null;

// Called by api.js whenever a mutating call can't go out immediately
// (offline, or a network-level failure on an online attempt).
export async function queueMutation(fn, args, { optimisticResult = null } = {}) {
  const clientId = uuid();
  const record = {
    clientId,
    fn,
    args,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: Date.now(),
    lastError: null
  };
  await QueueStore.add(record);
  emit('queue-changed', { record, action: 'queued' });
  requestSync();
  return {
    queued: true,
    clientId,
    ok: true,
    // Lets pages like entries.js render the new row immediately instead of
    // waiting for sync; pages should visually mark it "Pending".
    optimistic: optimisticResult
  };
}

export async function getQueueSnapshot() {
  const all = await QueueStore.all();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function retryFailedNow() {
  const failed = await QueueStore.byStatus(SYNC_STATUS.FAILED);
  await Promise.all(failed.map(r => QueueStore.update({ ...r, status: SYNC_STATUS.PENDING, attempts: 0 })));
  return flushQueue();
}

export async function removeQueuedItem(clientId) {
  await QueueStore.remove(clientId);
  emit('queue-changed', { clientId, action: 'removed' });
}

// Ask the browser to wake us (via SW 'sync' event) once connectivity
// returns. Falls back to listening for 'online' plus a periodic safety-net
// flush, since Background Sync isn't available on all platforms.
export function requestSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then(reg => reg.sync.register(SYNC_TAG))
      .catch(() => flushQueue()); // registration can fail (e.g. permission); just try directly
  } else {
    flushQueue();
  }
}

export function initSyncListeners() {
  window.addEventListener('online', () => flushQueue());

  // Safety net: some browsers silently drop the 'sync' event if the SW was
  // evicted, and iOS has no Background Sync API at all.
  if (_fallbackTimer) clearInterval(_fallbackTimer);
  _fallbackTimer = setInterval(() => {
    if (navigator.onLine) flushQueue();
  }, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'NSMS_SYNC_TRIGGER') flushQueue();
    });
  }

  // Attempt an initial flush on load in case items were queued last session.
  if (navigator.onLine) flushQueue();
}

function backoffDelay(attempts) {
  const delay = SYNC_RETRY_BASE_MS * Math.pow(2, attempts);
  return Math.min(delay, SYNC_RETRY_MAX_MS);
}

export async function flushQueue() {
  if (_flushing) return;
  _flushing = true;
  try {
    const pending = (await QueueStore.byStatus(SYNC_STATUS.PENDING));
    for (const record of pending) {
      await syncOne(record);
    }
  } finally {
    _flushing = false;
  }
}

async function syncOne(record) {
  await QueueStore.update({ ...record, status: SYNC_STATUS.SYNCING });
  emit('queue-changed', { record, action: 'syncing' });

  try {
    const result = await rawCall(record.fn, record.args, record.clientId);
    await QueueStore.remove(record.clientId);
    emit('queue-changed', { record: { ...record, status: SYNC_STATUS.SYNCED }, action: 'synced', result });
  } catch (err) {
    const attempts = record.attempts + 1;
    const isRetryable = err instanceof ApiError ? (err.isNetworkError || !navigator.onLine) : true;

    if (!isRetryable || attempts >= SYNC_MAX_ATTEMPTS) {
      const failedRecord = { ...record, attempts, status: SYNC_STATUS.FAILED, lastError: err.message };
      await QueueStore.update(failedRecord);
      emit('queue-changed', { record: failedRecord, action: 'failed' });
      return;
    }

    const pendingRecord = { ...record, attempts, status: SYNC_STATUS.PENDING, lastError: err.message };
    await QueueStore.update(pendingRecord);
    emit('queue-changed', { record: pendingRecord, action: 'retry-scheduled' });

    setTimeout(() => {
      if (navigator.onLine) flushQueue();
    }, backoffDelay(attempts));
  }
}
