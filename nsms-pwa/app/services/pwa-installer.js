// ============================================================================
// services/pwa-installer.js
// Call initPwa() once, early, from the app's bootstrap (index page load).
// This module owns: SW registration, exposing API_BASE_URL to the SW for
// background sync, the install-prompt lifecycle, and update notifications.
// It does NOT render UI itself — it dispatches events that a component
// (components/toast.js or a dedicated install-banner component) listens for,
// keeping this module UI-framework-agnostic.
// ============================================================================
import { API_BASE_URL } from '../utils/constants.js';
import { MetaStore } from './storage.js';

export const pwaEvents = new EventTarget();

let deferredInstallPrompt = null;
let swRegistration = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function initPwa() {
  // Give the SW's background-sync handler a way to know where to POST
  // queued mutations without importing constants.js (plain-script SW).
  try {
    await MetaStore.set('apiBaseUrl', API_BASE_URL);
  } catch (e) {
    console.warn('[pwa-installer] Could not persist apiBaseUrl for SW sync:', e);
  }

  registerServiceWorker();
  wireInstallPrompt();
  wireIosInstallHint();

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    pwaEvents.dispatchEvent(new CustomEvent('installed'));
  });
}

// ---------------------------------------------------------------------------
// Service worker registration + update flow
// ---------------------------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    swRegistration = await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    console.warn('[pwa-installer] Service worker registration failed:', err);
    return;
  }

  // A new SW version was found and finished installing while an older one
  // is still controlling the page — this is the "update available" moment.
  swRegistration.addEventListener('updatefound', () => {
    const newWorker = swRegistration.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        pwaEvents.dispatchEvent(new CustomEvent('update-available'));
      }
    });
  });

  // Reload once the new SW takes control, so the page picks up fresh assets.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// Called by the UI (e.g. a toast action button) when the user accepts an
// "Update available — reload now?" prompt.
export function applyPendingUpdate() {
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}

// Lets the UI trigger an immediate sync attempt (e.g. a manual "Retry now"
// button on a failed queue item) without waiting for the SyncManager.
export function requestManualSync() {
  if (swRegistration && swRegistration.active) {
    swRegistration.active.postMessage({ type: 'NSMS_MANUAL_SYNC' });
  }
}

// ---------------------------------------------------------------------------
// Install prompt (Android / desktop Chrome, Edge, Samsung Internet)
// ---------------------------------------------------------------------------

function wireInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Prevent the browser's default mini-infobar so the app controls when
    // and how the install offer is presented.
    event.preventDefault();
    deferredInstallPrompt = event;
    pwaEvents.dispatchEvent(new CustomEvent('installable', { detail: { platform: 'standard' } }));
  });
}

export function isInstallPromptAvailable() {
  return !!deferredInstallPrompt;
}

// Must be called synchronously from a user gesture (button click handler).
export async function promptInstall() {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  pwaEvents.dispatchEvent(new CustomEvent('install-choice', { detail: choice }));
  return choice; // { outcome: 'accepted' | 'dismissed' }
}

// ---------------------------------------------------------------------------
// iOS Safari fallback
// ---------------------------------------------------------------------------
// iOS Safari has no beforeinstallprompt — "Add to Home Screen" is a manual
// step from the Share sheet. We can only detect eligibility and prompt the
// UI to show instructions; we can't trigger the action programmatically.

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function wireIosInstallHint() {
  if (isIos() && !isInStandaloneMode()) {
    pwaEvents.dispatchEvent(new CustomEvent('installable', { detail: { platform: 'ios-manual' } }));
  }
}

export function getPlatformInstallState() {
  if (isInStandaloneMode()) return 'installed';
  if (isIos()) return 'ios-manual';
  if (deferredInstallPrompt) return 'promptable';
  return 'unavailable';
}
