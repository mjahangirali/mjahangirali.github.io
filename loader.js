// ============================================================================
// components/loader.js
// Skeleton placeholders (replaces the old plain-text "Loading..." states)
// and a small sync-status pill fed by services/sync.js's queue events.
// ============================================================================
import { getQueueSnapshot, syncEvents } from '../services/sync.js';
import { SYNC_STATUS } from '../utils/constants.js';

export function renderKpiSkeleton(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="ex-kpi skel-card" style="border-top-color:transparent;">
      <div class="skel skel-line" style="width:60%;height:16px;"></div>
      <div class="skel skel-line" style="width:40%;height:30px;margin-top:10px;"></div>
      <div class="skel skel-line" style="width:80%;"></div>
      <div class="skel skel-line" style="width:100%;height:8px;"></div>
    </div>
  `).join('');
}

export function renderCardSkeleton(height = 240) {
  return `<div class="skel skel-card" style="height:${height}px;"></div>`;
}

export function renderListSkeleton(rows = 4) {
  return Array.from({ length: rows }).map(() => `
    <div style="display:flex;gap:11px;align-items:center;padding:11px 0;">
      <div class="skel" style="width:44px;height:44px;border-radius:50%;flex-shrink:0;"></div>
      <div style="flex:1;">
        <div class="skel skel-line" style="width:70%;"></div>
        <div class="skel skel-line" style="width:45%;height:9px;"></div>
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Sync status pill — shows how many mutations are queued/syncing/failed.
// Mount once per page that submits data (wizard, entries).
// ---------------------------------------------------------------------------

const STATUS_META = {
  [SYNC_STATUS.PENDING]: { icon: 'schedule', label: 'queued' },
  [SYNC_STATUS.SYNCING]: { icon: 'sync', label: 'syncing' },
  [SYNC_STATUS.FAILED]: { icon: 'error_outline', label: 'failed — tap to retry' }
};

export function mountSyncPill(container, { onRetry } = {}) {
  const el = document.createElement('span');
  el.className = 'sync-pill';
  el.style.display = 'none';
  container.appendChild(el);

  async function render() {
    const items = await getQueueSnapshot();
    if (!items.length) { el.style.display = 'none'; return; }

    const counts = items.reduce((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; }, {});
    const worstStatus = counts[SYNC_STATUS.FAILED] ? SYNC_STATUS.FAILED
      : counts[SYNC_STATUS.SYNCING] ? SYNC_STATUS.SYNCING
      : SYNC_STATUS.PENDING;
    const meta = STATUS_META[worstStatus];

    el.className = `sync-pill ${worstStatus}`;
    el.innerHTML = `<span class="material-icons">${meta.icon}</span> ${items.length} ${meta.label}`;
    el.style.display = 'inline-flex';
    el.onclick = worstStatus === SYNC_STATUS.FAILED && onRetry ? onRetry : null;
  }

  render();
  const handler = () => render();
  syncEvents.addEventListener('queue-changed', handler);
  return () => syncEvents.removeEventListener('queue-changed', handler); // call to unmount
}
