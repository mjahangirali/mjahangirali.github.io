// ============================================================================
// pages/profile.js
// Ported from the original #viewProfile tab (name/role/CRM ID/SAP/City/
// Mobile/Email/Region + Logout). Adds real Settings functionality that the
// original only implied visually: change password, biometric unlock
// enable/disable, and a cache-clear utility — plus a Help & Support panel.
// ============================================================================
import { api } from '../services/api.js';
import { signOut, isBiometricSupported, isBiometricAvailable, isBiometricRegistered,
  registerBiometric, removeBiometric } from '../services/auth.js';
import { clearAllCached } from '../services/cache.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { escapeHtml } from '../utils/helpers.js';

export function mountProfilePage(root, { profile } = {}) {
  root.innerHTML = shellHtml(profile);
  const q = (sel) => root.querySelector(sel);

  const initials = (profile.empName || profile.crmId || '?').trim()[0].toUpperCase();
  q('#profInitial').textContent = initials;

  q('#profChangePwd').addEventListener('click', () => openPanel('changePwd'));
  q('#profSettings').addEventListener('click', () => openPanel('settings'));
  q('#profHelp').addEventListener('click', () => openPanel('help'));
  q('#profLogoutBtn').addEventListener('click', () => {
    if (confirm('Log out of NSMS on this device?')) {
      signOut();
      window.location.reload();
    }
  });

  // ---- panel switching (simple accordion-style sections below the card) ----
  const panels = { changePwd: q('#panelChangePwd'), settings: q('#panelSettings'), help: q('#panelHelp') };
  function openPanel(name) {
    const isOpen = panels[name].style.display === 'block';
    Object.values(panels).forEach((p) => { p.style.display = 'none'; });
    panels[name].style.display = isOpen ? 'none' : 'block';
    if (!isOpen && name === 'settings') refreshSettingsPanel();
  }

  // ---- change password ----
  q('#cpwSubmit').addEventListener('click', async () => {
    const cur = q('#cpwCurrent').value.trim();
    const nw = q('#cpwNew').value.trim();
    const con = q('#cpwConfirm').value.trim();
    const errEl = q('#cpwErr'), okEl = q('#cpwOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    if (!cur || !nw || !con) return showFieldMsg(errEl, 'All fields are required.');
    if (nw.length < 8) return showFieldMsg(errEl, 'New password must be at least 8 characters.');
    if (nw !== con) return showFieldMsg(errEl, 'New password and confirm password do not match.');
    if (nw === cur) return showFieldMsg(errEl, 'New password must be different from the current password.');

    const btn = q('#cpwSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await api.changePassword(profile.crmId, cur, nw);
      if (!res || res.error) { showFieldMsg(errEl, res?.error || 'Failed. Try again.'); }
      else {
        showFieldMsg(okEl, '✓ Password changed successfully.');
        q('#cpwCurrent').value = ''; q('#cpwNew').value = ''; q('#cpwConfirm').value = '';
      }
    } catch (e) {
      showFieldMsg(errEl, 'Error: ' + (e.message || e));
    }
    btn.disabled = false; btn.textContent = 'Change Password';
  });
  function showFieldMsg(el, msg) { el.textContent = msg; el.style.display = 'block'; }

  // ---- settings panel (biometric toggle + storage) ----
  async function refreshSettingsPanel() {
    const bioRow = q('#setBioRow');
    const bioToggle = q('#setBioToggle');
    const bioNote = q('#setBioNote');

    if (!isBiometricSupported() || !(await isBiometricAvailable())) {
      bioRow.style.display = 'none';
    } else {
      bioRow.style.display = 'flex';
      const registered = await isBiometricRegistered(profile.crmId);
      bioToggle.checked = registered;
      bioNote.textContent = registered
        ? 'Enabled on this device — Face ID / fingerprint can unlock NSMS instead of typing your password.'
        : 'Not set up on this device.';
    }
  }

  q('#setBioToggle').addEventListener('change', async (e) => {
    const wantOn = e.target.checked;
    try {
      if (wantOn) {
        await registerBiometric(profile.crmId, profile.empName);
        toastSuccess('Biometric unlock enabled for this device.');
      } else {
        await removeBiometric();
        toastSuccess('Biometric unlock disabled for this device.');
      }
    } catch (err) {
      e.target.checked = !wantOn;
      toastError('Could not update biometric unlock: ' + (err.message || err));
    }
    refreshSettingsPanel();
  });

  q('#setClearCache').addEventListener('click', async () => {
    if (!confirm('Clear cached dashboard/report data stored on this device? Anything not yet synced (queued entries) is kept.')) return;
    await clearAllCached();
    toastSuccess('Cached data cleared.');
  });

  return {
    unmount() { root.innerHTML = ''; }
  };
}

function shellHtml(profile) {
  return `
    <div class="dash-card" style="margin-top:14px;">
      <div class="prof-hd">
        <div class="prof-avatar" id="profInitial">?</div>
        <div>
          <div class="prof-name">${escapeHtml(profile.empName || '—')}</div>
          <div class="prof-role">${escapeHtml(profile.role || '—')}</div>
        </div>
      </div>
      <div class="prof-row"><span class="prof-lbl">CRM ID</span><span>${escapeHtml(profile.crmId || '—')}</span></div>
      <div class="prof-row"><span class="prof-lbl">SAP Number</span><span>${escapeHtml(profile.sapNumber || '—')}</span></div>
      <div class="prof-row"><span class="prof-lbl">City</span><span>${escapeHtml(profile.empCity || '—')}</span></div>
      <div class="prof-row"><span class="prof-lbl">Mobile</span><span>${escapeHtml(profile.mobileNumber || '—')}</span></div>
      <div class="prof-row"><span class="prof-lbl">Email</span><span>${escapeHtml(profile.email || '—')}</span></div>
      <div class="prof-row"><span class="prof-lbl">Region</span><span>${escapeHtml(profile.region || '—')}</span></div>

      <div class="prof-links">
        <button class="prof-link-btn" id="profChangePwd"><span>Change Password</span><span class="material-icons">chevron_right</span></button>
        <button class="prof-link-btn" id="profSettings"><span>Settings</span><span class="material-icons">chevron_right</span></button>
        <button class="prof-link-btn" id="profHelp"><span>Help &amp; Support</span><span class="material-icons">chevron_right</span></button>
      </div>
      <button class="btn btn-s" type="button" id="profLogoutBtn" style="margin-top:18px;width:100%;">Log Out</button>
    </div>

    <div class="dash-card" id="panelChangePwd" style="display:none;">
      <h3>Change Password</h3>
      <label class="cp-label">Current Password</label>
      <input type="password" id="cpwCurrent" class="cp-input" placeholder="Enter current password">
      <label class="cp-label">New Password</label>
      <input type="password" id="cpwNew" class="cp-input" placeholder="Min 8 characters">
      <label class="cp-label">Confirm New Password</label>
      <input type="password" id="cpwConfirm" class="cp-input" placeholder="Re-enter new password">
      <div id="cpwErr" class="cp-msg cp-msg-err" style="display:none;"></div>
      <div id="cpwOk" class="cp-msg cp-msg-ok" style="display:none;"></div>
      <button id="cpwSubmit" class="signin-btn">Change Password</button>
    </div>

    <div class="dash-card" id="panelSettings" style="display:none;">
      <h3>Settings</h3>
      <div class="set-row" id="setBioRow" style="display:none;">
        <div>
          <div class="set-row-label">Biometric unlock</div>
          <div class="set-row-note" id="setBioNote">Checking availability…</div>
        </div>
        <label class="set-switch"><input type="checkbox" id="setBioToggle"><span class="set-switch-slider"></span></label>
      </div>
      <div class="set-row">
        <div>
          <div class="set-row-label">Clear cached data</div>
          <div class="set-row-note">Removes cached dashboard/report data used for offline viewing. Queued (unsynced) entries are not affected.</div>
        </div>
        <button class="am2-btn am2-btn-sec" id="setClearCache">Clear</button>
      </div>
    </div>

    <div class="dash-card" id="panelHelp" style="display:none;">
      <h3>Help &amp; Support</h3>
      <p class="hint" style="margin-top:0;">For login issues, password resets, or account changes, contact your administrator.</p>
      <div class="prof-row"><span class="prof-lbl">Support Email</span><span><a href="mailto:support@nayatel.com">support@nayatel.com</a></span></div>
      <div class="prof-row"><span class="prof-lbl">App Version</span><span>3.0 (PWA)</span></div>
    </div>

    <div class="footer-note">v3.0 &middot; GPS captured automatically with each submission.</div>
  `;
}
