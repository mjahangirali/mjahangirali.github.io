// ============================================================================
// pages/login.js
// Ported from the original #signInPage + #cpModal markup in Index.html.
// Same fields, same first-login password-change flow; adds Remember Me,
// a device biometric unlock shortcut, and an idle-timeout-aware auto-login
// check (all via services/auth.js).
// ============================================================================
import { signIn, completeFirstLoginPasswordChange, attemptAutoLogin, isBiometricAvailable,
  isBiometricRegistered, registerBiometric, unlockWithBiometric, getBiometricMeta } from '../services/auth.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/helpers.js';

/**
 * @param {HTMLElement} root
 * @param {{ onSuccess: (profile: object) => void }} opts
 */
export function mountLoginPage(root, { onSuccess } = {}) {
  root.innerHTML = shellHtml();
  const q = (sel) => root.querySelector(sel);

  const el = {
    page: q('#loginPage'),
    identifier: q('#siIdentifier'),
    password: q('#siPassword'),
    pwdToggle: q('#siPwdToggle'),
    rememberMe: q('#siRememberMe'),
    err: q('#siErr'),
    btn: q('#siBtn'),
    forgot: q('#siForgot'),
    bioBtn: q('#siBioBtn'),
    bioLabel: q('#siBioLabel'),
    cpModal: q('#cpModal'),
    cpCurrent: q('#cpCurrent'),
    cpNew: q('#cpNew'),
    cpConfirm: q('#cpConfirm'),
    cpErr: q('#cpErr'),
    cpOk: q('#cpOk'),
    cpSubmitBtn: q('#cpSubmitBtn'),
    bioOfferModal: q('#bioOfferModal'),
    bioOfferYes: q('#bioOfferYes'),
    bioOfferNo: q('#bioOfferNo')
  };

  let pendingProfile = null; // set during first-login flow, pre-password-change

  // ---- wiring ----
  el.btn.addEventListener('click', doSignIn);
  el.identifier.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.password.focus(); });
  el.password.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
  el.pwdToggle.addEventListener('click', () => {
    const show = el.password.type === 'password';
    el.password.type = show ? 'text' : 'password';
    el.pwdToggle.textContent = show ? '🙈' : '👁';
    el.pwdToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  const showForgotNote = () => showToast('Password resets are handled by your administrator — ask them to issue a temporary password.');
  el.forgot.addEventListener('click', showForgotNote);
  el.forgot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showForgotNote(); } });
  el.cpSubmitBtn.addEventListener('click', doChangePassword);
  el.bioBtn.addEventListener('click', doBiometricUnlock);
  el.bioOfferYes.addEventListener('click', () => finishBiometricOffer(true));
  el.bioOfferNo.addEventListener('click', () => finishBiometricOffer(false));

  // ---- init: try auto-login, else show biometric shortcut if set up ----
  init();

  async function init() {
    const autoProfile = await attemptAutoLogin();
    if (autoProfile) { onSuccess(autoProfile); return; }
    await refreshBiometricShortcut();
  }

  async function refreshBiometricShortcut() {
    const meta = await getBiometricMeta();
    if (meta && meta.crmId) {
      el.identifier.value = meta.crmId;
      el.bioLabel.textContent = `Unlock as ${meta.crmId} with Face ID / Fingerprint`;
      el.bioBtn.style.display = 'flex';
    } else {
      el.bioBtn.style.display = 'none';
    }
  }

  async function doBiometricUnlock() {
    const crmId = el.identifier.value.trim();
    if (!crmId) { showError('Enter your CRM ID first, or use it as saved above.'); return; }
    el.bioBtn.disabled = true;
    try {
      const profile = await unlockWithBiometric(crmId, { rememberMe: true });
      onSuccess(profile);
    } catch (e) {
      showError(e.message || 'Biometric unlock failed.');
    }
    el.bioBtn.disabled = false;
  }

  async function doSignIn() {
    const identifier = el.identifier.value.trim();
    const password = el.password.value;
    hideError();

    if (!identifier) { showError('Enter your company email or mobile number.'); return; }
    if (!password) { showError('Enter your password.'); return; }

    el.btn.disabled = true;
    el.btn.textContent = 'Signing in…';
    try {
      const res = await signIn(identifier, password, { rememberMe: el.rememberMe.checked });
      if (!res) { showError('Server error. Try again.'); }
      else if (res.error) { showError(res.msg || 'Sign in failed.'); }
      else if (res.firstLogin) {
        pendingProfile = res;
        el.cpCurrent.value = ''; el.cpNew.value = ''; el.cpConfirm.value = '';
        el.cpErr.style.display = 'none'; el.cpOk.style.display = 'none';
        el.cpModal.style.display = 'flex';
      } else {
        await maybeOfferBiometric(res);
        onSuccess(res);
      }
    } catch (e) {
      showError('Connection error. Try again.');
    }
    el.btn.disabled = false;
    el.btn.textContent = 'Sign In';
  }

  async function doChangePassword() {
    const cur = el.cpCurrent.value.trim();
    const nw = el.cpNew.value.trim();
    const con = el.cpConfirm.value.trim();
    el.cpErr.style.display = 'none'; el.cpOk.style.display = 'none';

    if (!cur || !nw || !con) return showCpError('All fields are required.');
    if (nw.length < 8) return showCpError('New password must be at least 8 characters.');
    if (nw !== con) return showCpError('New password and Confirm password do not match.');
    if (nw === cur) return showCpError('New password must be different from the current password.');

    el.cpSubmitBtn.disabled = true;
    el.cpSubmitBtn.textContent = 'Saving…';
    try {
      const res = await completeFirstLoginPasswordChange(pendingProfile.crmId, cur, nw, pendingProfile, { rememberMe: el.rememberMe.checked });
      if (!res || res.error) {
        showCpError((res && res.error) || 'Failed. Try again.');
        el.cpSubmitBtn.disabled = false;
        el.cpSubmitBtn.textContent = 'Set Password & Continue';
        return;
      }
      el.cpOk.textContent = '✓ Password changed! Logging you in…';
      el.cpOk.style.display = 'block';
      const profile = pendingProfile;
      setTimeout(async () => {
        el.cpModal.style.display = 'none';
        pendingProfile = null;
        await maybeOfferBiometric(profile);
        onSuccess(profile);
      }, 1200);
    } catch (e) {
      showCpError('Error: ' + (e.message || e));
      el.cpSubmitBtn.disabled = false;
      el.cpSubmitBtn.textContent = 'Set Password & Continue';
    }
  }

  // ---- one-time biometric enrollment offer, right after a real password login ----
  let bioOfferResolve = null;
  async function maybeOfferBiometric(profile) {
    if (!(await isBiometricAvailable())) return;
    if (await isBiometricRegistered(profile.crmId)) return;
    el.bioOfferModal.style.display = 'flex';
    await new Promise((resolve) => { bioOfferResolve = resolve; });
    if (pendingBiometricAccept) {
      try {
        await registerBiometric(profile.crmId, profile.empName);
        showToast('Biometric unlock enabled for this device.', { type: 'success' });
      } catch (e) {
        showToast('Could not enable biometric unlock: ' + (e.message || e), { type: 'error' });
      }
    }
  }
  let pendingBiometricAccept = false;
  function finishBiometricOffer(accept) {
    pendingBiometricAccept = accept;
    el.bioOfferModal.style.display = 'none';
    if (bioOfferResolve) { bioOfferResolve(); bioOfferResolve = null; }
  }

  function showError(msg) { el.err.textContent = msg; el.err.style.display = 'block'; }
  function hideError() { el.err.style.display = 'none'; }
  function showCpError(msg) { el.cpErr.textContent = msg; el.cpErr.style.display = 'block'; }

  return {
    unmount() { root.innerHTML = ''; }
  };
}

// ============================================================================
// Static markup
// ============================================================================
function shellHtml() {
  return `
  <div id="cpModal" class="cp-overlay" style="display:none;">
    <div class="cp-modal">
      <div class="cp-modal-hd">
        <div class="cp-modal-title">🔐 Set New Password</div>
        <div class="cp-modal-sub">You must set a new password before continuing.</div>
      </div>
      <div class="cp-modal-body">
        <label class="cp-label">Current / Temporary Password</label>
        <input type="password" id="cpCurrent" class="cp-input" placeholder="Enter current password">
        <label class="cp-label">New Password</label>
        <input type="password" id="cpNew" class="cp-input" placeholder="Min 8 characters">
        <label class="cp-label">Confirm New Password</label>
        <input type="password" id="cpConfirm" class="cp-input" placeholder="Re-enter new password">
        <div id="cpErr" class="cp-msg cp-msg-err" style="display:none;"></div>
        <div id="cpOk" class="cp-msg cp-msg-ok" style="display:none;"></div>
        <button id="cpSubmitBtn" class="signin-btn">Set Password &amp; Continue</button>
      </div>
    </div>
  </div>

  <div id="bioOfferModal" class="cp-overlay" style="display:none;">
    <div class="cp-modal" style="max-width:360px;">
      <div class="cp-modal-hd">
        <div class="cp-modal-title">Enable quick unlock?</div>
        <div class="cp-modal-sub">Use Face ID, Touch ID, or your device's fingerprint sensor to skip typing your password next time on this device.</div>
      </div>
      <div class="cp-modal-body" style="display:flex;gap:10px;">
        <button id="bioOfferNo" class="btn btn-s" style="flex:1;">Not now</button>
        <button id="bioOfferYes" class="signin-btn" style="flex:1;margin-top:0;">Enable</button>
      </div>
    </div>
  </div>

  <div id="loginPage" class="signin-page">
    <div class="si-wrap">
      <div class="si-logo-badge"><span class="material-icons">bolt</span></div>
      <div class="si-logo-wrap"><span class="si-logo-naya">NAYA</span><span class="si-logo-tel">tel</span></div>
      <div class="si-subtitle">Sales Management System</div>

      <label class="signin-label">CRM ID</label>
      <input type="text" id="siIdentifier" class="si-input" placeholder="Enter your CRM ID" autocomplete="username">

      <label class="signin-label">Password</label>
      <div class="pwd-wrap">
        <input type="password" id="siPassword" class="si-input" placeholder="Enter your password" autocomplete="current-password">
        <button type="button" class="pwd-toggle" id="siPwdToggle" aria-label="Show password">&#128065;</button>
      </div>

      <div class="si-row-between">
        <label class="si-remember"><input type="checkbox" id="siRememberMe" checked> Remember me</label>
        <span class="si-forgot" id="siForgot" role="button" tabindex="0">Forgot Password?</span>
      </div>

      <div class="signin-err" id="siErr"></div>
      <button type="button" class="signin-btn" id="siBtn">LOGIN</button>

      <button type="button" id="siBioBtn" class="bio-btn" style="display:none;">
        <span class="material-icons">fingerprint</span><span id="siBioLabel">Unlock with biometrics</span>
      </button>

      <div class="signin-footer-note">Version 3.0</div>
    </div>
  </div>`;
}

