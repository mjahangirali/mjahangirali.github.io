// ============================================================================
// services/auth.js
// Session lifecycle: sign in, auto-login on app start, idle timeout, and an
// optional biometric "unlock" layer on top of the cached session.
//
// IMPORTANT — what the biometric feature actually is: Code.gs / ApiBridge.gs
// have no WebAuthn public-key store or challenge/signature verification.
// Building real server-verified WebAuthn would need that on the backend,
// which is out of scope for "reuse existing APIs, don't rewrite backend
// logic." So this is a *local device unlock gate*: after a normal
// email/password signIn(), the device can register a platform authenticator
// (Face ID / Touch ID / Windows Hello) purely to gate whether THIS device
// releases the session it already cached. It proves "the device owner is
// present," not "the server re-verified this person" — the actual identity
// check already happened at signIn() time via the real password. Comments
// below call this out again at the two functions that matter.
// ============================================================================
import { api } from './api.js';
import { MetaStore } from './storage.js';
import {
  SESSION_STORAGE_KEY, SESSION_TIMEOUT_MS, REMEMBER_ME_TIMEOUT_MS, BIOMETRIC_META_KEY
} from '../utils/constants.js';

export const authEvents = new EventTarget();
function emit(type, detail) { authEvents.dispatchEvent(new CustomEvent(type, { detail })); }

let idleTimer = null;

// ---------------------------------------------------------------------------
// Session storage — localStorage when "Remember Me" is checked (survives
// browser/app restarts, 30-day idle timeout), sessionStorage otherwise
// (cleared when the tab/app fully closes, 8h idle timeout).
// ---------------------------------------------------------------------------

function currentStore(rememberMe) {
  return rememberMe ? window.localStorage : window.sessionStorage;
}

function readRawSession() {
  // Session could be in either store depending on how it was created; check
  // both rather than trusting a single flag that itself lives in storage.
  // Wrapped defensively: some mobile browser privacy modes throw on
  // storage access entirely rather than just returning null, and an
  // uncaught throw here would leave the caller (attemptAutoLogin, called
  // during app boot before the splash screen is hidden) stuck.
  try {
    const fromLocal = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (fromLocal) return { raw: fromLocal, store: window.localStorage };
    const fromSession = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (fromSession) return { raw: fromSession, store: window.sessionStorage };
  } catch (e) {
    console.warn('[auth] Storage access blocked:', e);
  }
  return null;
}

function saveSession(profile, rememberMe) {
  const record = {
    crmId: profile.crmId,
    profile,
    rememberMe: !!rememberMe,
    lastActivity: Date.now()
  };
  const store = currentStore(rememberMe);
  // Clear the other store so a later "remember me" change doesn't leave two
  // stale copies with different expiry rules.
  const other = rememberMe ? window.sessionStorage : window.localStorage;
  other.removeItem(SESSION_STORAGE_KEY);
  store.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  stopIdleTracking();
}

function getSessionTimeoutMs(rememberMe) {
  return rememberMe ? REMEMBER_ME_TIMEOUT_MS : SESSION_TIMEOUT_MS;
}

function isExpired(record) {
  const timeout = getSessionTimeoutMs(record.rememberMe);
  return (Date.now() - record.lastActivity) > timeout;
}

export function touchActivity() {
  const found = readRawSession();
  if (!found) return;
  try {
    const record = JSON.parse(found.raw);
    record.lastActivity = Date.now();
    found.store.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
  } catch (e) { /* corrupt record — next auto-login check will clear it */ }
}

function startIdleTracking() {
  stopIdleTracking();
  const bump = () => touchActivity();
  ['click', 'keydown', 'touchstart', 'visibilitychange'].forEach((evt) => window.addEventListener(evt, bump, { passive: true }));
  idleTimer = setInterval(() => {
    const found = readRawSession();
    if (!found) return;
    try {
      const record = JSON.parse(found.raw);
      if (isExpired(record)) {
        clearSession();
        emit('session-expired', { crmId: record.crmId });
      }
    } catch (e) { clearSession(); }
  }, 60000); // check once a minute — frequent enough without being wasteful
  idleTimer._bump = bump;
}

function stopIdleTracking() {
  if (idleTimer) {
    clearInterval(idleTimer);
    if (idleTimer._bump) {
      ['click', 'keydown', 'touchstart', 'visibilitychange'].forEach((evt) => window.removeEventListener(evt, idleTimer._bump));
    }
    idleTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------

export async function signIn(identifier, password, { rememberMe = false } = {}) {
  const res = await api.signIn(identifier, password);
  if (!res || res.error) return res; // { error, msg } — caller shows res.msg

  if (res.firstLogin) {
    // Don't persist a session yet — the caller must complete changePassword()
    // first (mirrors the original mandatory first-login flow).
    return res;
  }

  saveSession(res, rememberMe);
  startIdleTracking();
  emit('signed-in', { profile: res });
  return res;
}

export async function completeFirstLoginPasswordChange(crmId, currentPwd, newPwd, profile, { rememberMe = false } = {}) {
  const res = await api.changePassword(crmId, currentPwd, newPwd);
  if (!res || res.error) return res;
  saveSession(profile, rememberMe);
  startIdleTracking();
  emit('signed-in', { profile });
  return res;
}

export function signOut() {
  const found = readRawSession();
  let crmId = null;
  try { crmId = found && JSON.parse(found.raw).crmId; } catch (e) {}
  clearSession();
  emit('signed-out', { crmId });
}

// ---------------------------------------------------------------------------
// Auto-login — called once at app startup. Revalidates against the server
// (the account may have been deactivated/edited since the session was
// cached) rather than trusting the local copy blindly.
// ---------------------------------------------------------------------------

export async function attemptAutoLogin() {
  const found = readRawSession();
  if (!found) return null;

  let record;
  try { record = JSON.parse(found.raw); } catch (e) { clearSession(); return null; }

  if (isExpired(record)) {
    clearSession();
    emit('session-expired', { crmId: record.crmId });
    return null;
  }

  try {
    const profile = await api.getProfile(record.crmId);
    if (!profile) { clearSession(); return null; }
    // Refresh the cached profile in case role/city/etc changed server-side.
    saveSession(profile, record.rememberMe);
    startIdleTracking();
    emit('signed-in', { profile, auto: true });
    return profile;
  } catch (err) {
    // Network failure during auto-login (e.g. opening the installed PWA
    // offline) — don't log the user out just because we couldn't reach the
    // server; let them continue with the cached profile and stale-data
    // banners elsewhere in the app will make the offline state visible.
    startIdleTracking();
    emit('signed-in', { profile: record.profile, auto: true, offline: true });
    return record.profile;
  }
}

export function getCachedProfile() {
  const found = readRawSession();
  if (!found) return null;
  try { return JSON.parse(found.raw).profile; } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Biometric device unlock (see file header — local gate, not server auth)
// ---------------------------------------------------------------------------

export function isBiometricSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

export async function isBiometricAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

export async function isBiometricRegistered(crmId) {
  try {
    const saved = await MetaStore.get(BIOMETRIC_META_KEY);
    return !!(saved && saved.crmId === crmId && saved.credentialId);
  } catch (e) {
    return false;
  }
}

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

// Call this right after a successful password signIn(), from a user gesture
// (e.g. "Enable Face ID / fingerprint unlock?" prompt shown once).
export async function registerBiometric(crmId, displayName) {
  if (!(await isBiometricAvailable())) throw new Error('Biometric authentication is not available on this device.');

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'NSMS — Nayatel Sales Management System' },
      user: {
        id: new TextEncoder().encode(crmId),
        name: crmId,
        displayName: displayName || crmId
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
      attestation: 'none'
    }
  });

  if (!credential) throw new Error('Biometric registration was cancelled.');

  await MetaStore.set(BIOMETRIC_META_KEY, {
    crmId,
    credentialId: toBase64Url(credential.rawId)
  });
  emit('biometric-registered', { crmId });
  return true;
}

// Gates release of the already-cached session behind a local biometric
// prompt. Does NOT contact the server — see file header.
export async function verifyBiometricUnlock(crmId) {
  const saved = await MetaStore.get(BIOMETRIC_META_KEY);
  if (!saved || saved.crmId !== crmId || !saved.credentialId) {
    throw new Error('Biometric unlock is not set up on this device.');
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: fromBase64Url(saved.credentialId), type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000
    }
  });

  if (!assertion) throw new Error('Biometric verification was cancelled.');
  emit('biometric-unlocked', { crmId });
  return true;
}

export async function removeBiometric() {
  try { await MetaStore.set(BIOMETRIC_META_KEY, null); } catch (e) {}
}

// Composite convenience flow for the login page: verify the device owner
// locally, then re-fetch a fresh profile and establish a normal session —
// used when a returning user's session has expired/been cleared but they
// don't want to re-type CRM ID + password on this device.
export async function unlockWithBiometric(crmId, { rememberMe = true } = {}) {
  await verifyBiometricUnlock(crmId);
  const profile = await api.getProfile(crmId);
  if (!profile) throw new Error('Account not found for this device\'s saved biometric unlock.');
  saveSession(profile, rememberMe);
  startIdleTracking();
  emit('signed-in', { profile, viaBiometric: true });
  return profile;
}

export async function getBiometricMeta() {
  try { return await MetaStore.get(BIOMETRIC_META_KEY); } catch (e) { return null; }
}
