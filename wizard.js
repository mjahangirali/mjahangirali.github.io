// ============================================================================
// pages/wizard.js
// Ported from the original 8-step wizard in Index.html (wizGoNext/wizGoPrev/
// validateStep/silentOk/populateCategories/mInitPkg/captureGPSForEntry/etc).
// Same steps, same auto-advance behavior, same GPS capture; submission now
// goes through api.js, so a submit made offline is queued and synced
// automatically instead of failing outright.
// ============================================================================
import { api } from '../services/api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { PACKAGE_CATALOG, formatPkr } from '../utils/constants.js';
import { escapeHtml } from '../utils/helpers.js';

const STEPS = 8;
const TITLES = ['Entry Type', 'Interaction Type', 'Customer Information', 'Package Information', 'Source of Information (SOI)', 'Status', 'Remarks', 'Door-to-Door Activity'];

export function mountWizardPage(root, { crmId, empName, sapNumber, empCity, mobileNumber, email, onSubmitted } = {}) {
  root.innerHTML = shellHtml();
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => Array.from(root.querySelectorAll(sel));

  const state = {
    currentStep: 1,
    serverDateTime: null,
    gpsWarmed: false,
    advTimer: null,
    destroyed: false
  };

  const el = {
    backBtn: q('#stepBackBtn'), badge: q('#stepBadge'), title: q('#stepTitle'),
    stepNum: q('#stepNum'), dots: q('#stepDots'), skipBtn: q('#skipBtn'), submitBtn: q('#submitBtn'),
    custContact: q('#custContact'), dupWarn: q('#dupWarn'),
    packageCategory: q('#packageCategory'), packageInterested: q('#packageInterested'),
    manualPackageWrap: q('#manualPackageWrap'), manualPackageName: q('#manualPackageName'), packageMrc: q('#packageMrc'),
    pkgPreview: q('#pkgPreview'), ppName: q('#ppName'), ppType: q('#ppType'), ppMrc: q('#ppMrc'),
    soi: q('#soi'), soiUserIdWrap: q('#soiUserIdWrap'), soiUserId: q('#soiUserId'),
    status: q('#status'), matureBox: q('#matureBox'), userId: q('#userId'),
    mPkgCat: q('#mPkgCat'), mPkgPkg: q('#mPkgPkg'), mManualWrap: q('#mManualWrap'), mManualName: q('#mManualName'),
    mPkgMrc: q('#mPkgMrc'), mPkgPreview: q('#mPkgPreview'), mPpName: q('#mPpName'), mPpType: q('#mPpType'), mPpMrc: q('#mPpMrc'),
    remarks: q('#remarks'), brochures: q('#brochures')
  };

  init();

  async function init() {
    try { state.serverDateTime = await api.getServerDateTime(); }
    catch (e) { state.serverDateTime = { date: new Date().toISOString().slice(0, 10), time: new Date().toLocaleTimeString() }; }
    prewarmGPS();
    goToStep(1);
  }

  // ---- step navigation ----
  function renderDots() {
    el.dots.innerHTML = Array.from({ length: STEPS }, (_, i) => {
      const n = i + 1;
      const cls = n < state.currentStep ? 'done' : n === state.currentStep ? 'active' : '';
      return `<span class="step-dot ${cls}"></span>`;
    }).join('');
  }

  function currentCustType() { return root.querySelector('input[name="custType"]:checked'); }

  function goToStep(n) {
    state.currentStep = n;
    qa('.step-panel').forEach((p) => { p.style.display = Number(p.dataset.step) === n ? 'block' : 'none'; });
    el.badge.textContent = n; el.title.textContent = TITLES[n - 1]; el.stepNum.textContent = n;
    el.backBtn.disabled = n === 1;
    el.skipBtn.style.display = (n === 3 || n === 7) ? 'inline' : 'none';
    el.skipBtn.textContent = n === 3 ? 'Continue without optional \u2192' : 'Continue without remarks \u2192';
    const ct = currentCustType();
    const isLastForCorp = (n === 7 && ct && ct.value === 'Corporate');
    const isLast = n === STEPS || isLastForCorp;
    el.submitBtn.style.display = isLast ? 'block' : 'none';
    renderDots();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function wizGoNext() {
    if (!validateStep(state.currentStep)) return;
    let next = state.currentStep + 1;
    const ct = currentCustType();
    if (next === 8 && ct && ct.value === 'Corporate') next = 9; // skip D2D (Step 8) for Corporate
    if (next <= STEPS) goToStep(next);
  }
  function wizGoPrev() {
    let prev = state.currentStep - 1;
    const ct = currentCustType();
    if (prev === 7 && ct && ct.value === 'Corporate') prev = 6;
    if (prev >= 1) goToStep(prev);
  }
  el.backBtn.addEventListener('click', wizGoPrev);
  el.skipBtn.addEventListener('click', wizGoNext);

  function autoAdv(delay = 220) {
    clearTimeout(state.advTimer);
    state.advTimer = setTimeout(() => { if (validateStep(state.currentStep)) wizGoNext(); }, delay);
  }

  function setFieldError(fieldEl, hasErr) {
    const wrap = fieldEl.closest('div') || fieldEl.parentElement;
    wrap.classList.toggle('fe', hasErr);
    return !hasErr;
  }
  function showStepError(id, show) { const e = root.querySelector('#' + id); if (e) e.style.display = show ? 'block' : 'none'; }

  bindCardGroup('custType', (val) => {
    populateCategories(val);
    if (el.status.value === 'Matured') mInitPkg(val);
    if (state.currentStep === 1) autoAdv(200);
  });

  bindCardGroup('contactMode', () => { wizUpdateSubType(); if (state.currentStep === 2 && silentOk(2)) autoAdv(200); });

  function bindCardGroup(groupName, onSelect) {
    qa(`input[name="${groupName}"]`).forEach((input) => {
      const card = input.closest('.opt, .et-card');
      card.addEventListener('click', () => {
        qa(`input[name="${groupName}"]`).forEach((i) => i.closest('.opt, .et-card').classList.remove('sel'));
        card.classList.add('sel');
        input.checked = true;
        onSelect(input.value);
      });
    });
  }

  function wizSetSubType(fieldId, value, cardEl) {
    const field = q('#' + fieldId);
    if (field) field.value = value;
    const grid = cardEl.closest('.et-grid');
    grid?.querySelectorAll('.et-card').forEach((c) => c.classList.remove('sel'));
    cardEl.classList.add('sel');
    if (silentOk(2)) autoAdv(200);
  }
  qa('#visitTypeCards .et-card').forEach((card) => card.addEventListener('click', () => wizSetSubType('visitType', card.dataset.value, card)));
  qa('#callTypeCards .et-card').forEach((card) => card.addEventListener('click', () => wizSetSubType('callType', card.dataset.value, card)));

  function wizUpdateSubType() {
    const cm = root.querySelector('input[name="contactMode"]:checked');
    const isVisit = cm && cm.value === 'Visit';
    const isCall = cm && cm.value === 'Call';
    q('#visitTypeWrap').style.display = isVisit ? 'block' : 'none';
    q('#callTypeWrap').style.display = isCall ? 'block' : 'none';
    if (!isVisit) { q('#visitType').value = ''; qa('#visitTypeCards .et-card').forEach((c) => c.classList.remove('sel')); }
    if (!isCall) { q('#callType').value = ''; qa('#callTypeCards .et-card').forEach((c) => c.classList.remove('sel')); }
  }

  function buildAddress() {
    const city = q('#custCity').value;
    const area = q('#custArea').value.trim();
    const house = q('#custHouseNo')?.value.trim() || '';
    const street = q('#custStreetNo')?.value.trim() || '';
    const landmark = q('#custLandmark')?.value.trim() || '';
    const parts = [house, street, landmark, area, city].filter(Boolean);
    q('#custAddress').value = parts.join(', ');
    if (state.currentStep === 3 && silentOk(3)) autoAdv(500);
  }
  ['custName', 'custContact', 'custAddress'].forEach((id) => q('#' + id).addEventListener('input', () => { if (state.currentStep === 3 && silentOk(3)) autoAdv(500); }));
  ['custHouseNo', 'custStreetNo', 'custLandmark'].forEach((id) => q('#' + id)?.addEventListener('input', buildAddress));
  q('#custCity').addEventListener('change', buildAddress);
  q('#custArea').addEventListener('input', buildAddress);

  el.custContact.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11); el.dupWarn.style.display = 'none'; });
  el.custContact.addEventListener('blur', async (e) => {
    const v = e.target.value.trim();
    if (!/^\d{11}$/.test(v)) return;
    try { const r = await api.checkDuplicateContact(v); el.dupWarn.style.display = (r && r.exists) ? 'block' : 'none'; } catch (e) { /* non-fatal */ }
  });

  function populateCategories(custType) {
    const sel = el.packageCategory;
    if (!custType || !PACKAGE_CATALOG[custType]) {
      sel.disabled = true; sel.innerHTML = '<option value="">Select customer type first</option>';
      populatePkgs(custType, ''); return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a category</option>' + Object.keys(PACKAGE_CATALOG[custType]).map((c) => `<option>${escapeHtml(c)}</option>`).join('');
    populatePkgs(custType, '');
  }
  function populatePkgs(custType, cat) {
    const sel = el.packageInterested, mw = el.manualPackageWrap, mf = el.packageMrc;
    el.manualPackageName.value = ''; mf.value = ''; el.pkgPreview.style.display = 'none';
    if (!custType || !cat) {
      sel.disabled = true; sel.innerHTML = '<option value="">Select a category first</option>'; sel.style.display = ''; mw.style.display = 'none'; mf.disabled = true; return;
    }
    const list = PACKAGE_CATALOG[custType][cat];
    if (list) {
      sel.disabled = false; sel.style.display = ''; mw.style.display = 'none';
      sel.innerHTML = '<option value="">Select a package</option>' + list.map((p) => `<option value="${escapeHtml(p.name)}" data-mrc="${p.mrc}">${escapeHtml(p.name)} - ${formatPkr(p.mrc)}</option>`).join('');
      mf.disabled = true; mf.placeholder = 'Auto-filled when package selected';
    } else {
      sel.disabled = true; sel.style.display = 'none'; mw.style.display = 'block'; mf.disabled = false; mf.placeholder = 'Enter agreed MRC';
    }
    syncPkgPreview();
  }
  function getPkgName() {
    const ct = currentCustType(); if (!ct) return '';
    const cat = el.packageCategory.value;
    const list = (cat && PACKAGE_CATALOG[ct.value]) ? PACKAGE_CATALOG[ct.value][cat] : null;
    return list ? el.packageInterested.value : el.manualPackageName.value.trim();
  }
  function syncPkgPreview() {
    const cat = el.packageCategory.value, name = getPkgName(), mrc = el.packageMrc.value;
    if (name && mrc) { el.pkgPreview.style.display = 'block'; el.ppName.textContent = name; el.ppType.textContent = cat || '-'; el.ppMrc.textContent = formatPkr(mrc); }
    else el.pkgPreview.style.display = 'none';
    if (state.currentStep === 4 && silentOk(4)) autoAdv(400);
  }
  el.packageCategory.addEventListener('change', (e) => { const ct = currentCustType(); populatePkgs(ct ? ct.value : '', e.target.value); });
  el.packageInterested.addEventListener('change', (e) => { const o = e.target.selectedOptions[0]; el.packageMrc.value = o?.dataset.mrc || ''; syncPkgPreview(); });
  el.manualPackageName.addEventListener('input', syncPkgPreview);
  el.packageMrc.addEventListener('input', syncPkgPreview);

  el.soi.addEventListener('change', () => { wizToggleUserId(); if (state.currentStep === 5 && silentOk(5)) autoAdv(300); });
  el.soiUserId.addEventListener('input', () => { if (state.currentStep === 5 && silentOk(5)) autoAdv(400); });
  function wizToggleUserId() {
    const isExisting = el.soi.value === 'Existing Customer';
    el.soiUserIdWrap.style.display = isExisting ? 'block' : 'none';
    if (!isExisting) el.soiUserId.value = '';
  }

  el.status.addEventListener('change', () => {
    const isMatured = el.status.value === 'Matured';
    el.matureBox.style.display = isMatured ? 'block' : 'none';
    if (isMatured) { const ct = currentCustType(); mInitPkg(ct ? ct.value : ''); }
    syncPkgPreview();
    if (state.currentStep === 6 && silentOk(6)) autoAdv(300);
  });
  ['userId', 'mPkgCat', 'mPkgPkg', 'mManualName', 'mPkgMrc'].forEach((id) => {
    const field = q('#' + id); if (!field) return;
    field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => { if (state.currentStep === 6 && silentOk(6)) autoAdv(400); });
  });

  function mInitPkg(custType) {
    const sel = el.mPkgCat;
    if (!custType || !PACKAGE_CATALOG[custType]) {
      sel.disabled = true; sel.innerHTML = '<option value="">Select customer type first</option>';
      el.mPkgPkg.disabled = true; el.mPkgPkg.innerHTML = '<option value="">Select a category first</option>';
      el.mManualWrap.style.display = 'none'; el.mPkgMrc.value = ''; el.mPkgPreview.style.display = 'none';
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a category</option>' + Object.keys(PACKAGE_CATALOG[custType]).map((c) => `<option>${escapeHtml(c)}</option>`).join('');
    el.mPkgPkg.disabled = true; el.mPkgPkg.innerHTML = '<option value="">Select a category first</option>'; el.mManualWrap.style.display = 'none';
  }
  function mPkgCatChange() {
    const ct = currentCustType();
    const cat = el.mPkgCat.value;
    el.mManualName.value = ''; el.mPkgMrc.value = ''; el.mPkgPreview.style.display = 'none';
    if (!ct || !cat) { el.mPkgPkg.disabled = true; el.mPkgPkg.innerHTML = '<option value="">Select a category first</option>'; el.mManualWrap.style.display = 'none'; return; }
    const list = PACKAGE_CATALOG[ct.value][cat];
    if (list) {
      el.mPkgPkg.disabled = false; el.mPkgPkg.style.display = ''; el.mManualWrap.style.display = 'none';
      el.mPkgPkg.innerHTML = '<option value="">Select a package</option>' + list.map((p) => `<option value="${escapeHtml(p.name)}" data-mrc="${p.mrc}">${escapeHtml(p.name)} - ${formatPkr(p.mrc)}</option>`).join('');
      el.mPkgMrc.disabled = true; el.mPkgMrc.placeholder = 'Auto-filled when package selected';
    } else {
      el.mPkgPkg.disabled = true; el.mPkgPkg.style.display = 'none'; el.mManualWrap.style.display = 'block';
      el.mPkgMrc.disabled = false; el.mPkgMrc.placeholder = 'Enter agreed MRC';
    }
  }
  function mSyncPreview() {
    const cat = el.mPkgCat.value;
    const name = el.mPkgPkg.value || el.mManualName.value.trim();
    const mrc = el.mPkgMrc.value;
    if (name && mrc) { el.mPkgPreview.style.display = 'block'; el.mPpName.textContent = name; el.mPpType.textContent = cat || '-'; el.mPpMrc.textContent = formatPkr(mrc); }
    else el.mPkgPreview.style.display = 'none';
  }
  el.mPkgCat.addEventListener('change', mPkgCatChange);
  el.mPkgPkg.addEventListener('change', () => { const o = el.mPkgPkg.selectedOptions[0]; el.mPkgMrc.value = o?.dataset.mrc || ''; mSyncPreview(); });
  el.mManualName.addEventListener('input', mSyncPreview);
  el.mPkgMrc.addEventListener('input', mSyncPreview);

  el.remarks.addEventListener('blur', () => { if (state.currentStep === 7) autoAdv(100); });

  q('#brochMinus').addEventListener('click', () => { el.brochures.value = Math.max(0, (parseInt(el.brochures.value) || 0) - 1); });
  q('#brochPlus').addEventListener('click', () => { el.brochures.value = (parseInt(el.brochures.value) || 0) + 1; });

  function validateStep(n) {
    let ok = true;
    if (n === 1) {
      const c = currentCustType();
      showStepError('err-custType', !c); if (!c) ok = false;
    }
    if (n === 2) {
      const cm = root.querySelector('input[name="contactMode"]:checked');
      showStepError('err-contactMode', !cm); if (!cm) ok = false;
      if (cm) {
        if (cm.value === 'Visit') { const vt = q('#visitType').value; showStepError('err-visitType', !vt); if (!vt) ok = false; }
        else { const ct2 = q('#callType').value; showStepError('err-callType', !ct2); if (!ct2) ok = false; }
      }
    }
    if (n === 3) {
      if (!setFieldError(q('#custName'), !q('#custName').value.trim())) ok = false;
      if (!setFieldError(el.custContact, !/^\d{11}$/.test(el.custContact.value.trim()))) ok = false;
      const cityEl = q('#custCity'); showStepError('err-custCity', !cityEl.value); if (!cityEl.value) ok = false;
      const hn = q('#custHouseNo'); if (hn) { showStepError('err-custHouseNo', !hn.value.trim()); if (!hn.value.trim()) ok = false; }
      const areaEl = q('#custArea'); showStepError('err-custArea', !areaEl.value.trim()); if (!areaEl.value.trim()) ok = false;
      if (!setFieldError(q('#custAddress'), !q('#custAddress').value.trim())) ok = false;
    }
    if (n === 4) {
      if (!setFieldError(el.packageCategory, !el.packageCategory.value)) ok = false;
      const ct = currentCustType(); const cat = el.packageCategory.value;
      const list = (ct && cat) ? PACKAGE_CATALOG[ct.value][cat] : null;
      if (list) { if (!setFieldError(el.packageInterested, !el.packageInterested.value)) ok = false; }
      else if (cat) { if (!setFieldError(el.manualPackageName, !el.manualPackageName.value.trim())) ok = false; }
      const mrcVal = el.packageMrc.value;
      if (!setFieldError(el.packageMrc, mrcVal === '' || isNaN(mrcVal) || Number(mrcVal) < 0)) ok = false;
    }
    if (n === 5) {
      if (!setFieldError(el.soi, !el.soi.value)) ok = false;
      if (el.soi.value === 'Existing Customer') { showStepError('err-soiUserId', !el.soiUserId.value.trim()); if (!el.soiUserId.value.trim()) ok = false; }
    }
    if (n === 6) {
      if (!setFieldError(el.status, !el.status.value)) ok = false;
      if (el.status.value === 'Matured') {
        if (!setFieldError(el.userId, !el.userId.value.trim())) ok = false;
        const mCat = el.mPkgCat.value; showStepError('err-mPkgCat', !mCat); if (!mCat) ok = false;
        if (mCat) {
          const ct = currentCustType();
          const list = (ct && PACKAGE_CATALOG[ct.value]) ? PACKAGE_CATALOG[ct.value][mCat] : null;
          if (list) { showStepError('err-mPkgPkg', !el.mPkgPkg.value); if (!el.mPkgPkg.value) ok = false; }
          else { const mn = el.mManualName.value.trim(); showStepError('err-mManualName', !mn); if (!mn) ok = false; }
        }
        const mm = el.mPkgMrc.value;
        showStepError('err-mPkgMrc', !(mm !== '' && !isNaN(mm) && Number(mm) >= 0));
        if (mm === '' || isNaN(mm) || Number(mm) < 0) ok = false;
      }
    }
    return ok;
  }

  function silentOk(n) {
    if (n === 1) return !!currentCustType();
    if (n === 2) {
      const cm = root.querySelector('input[name="contactMode"]:checked');
      if (!cm) return false;
      return cm.value === 'Visit' ? !!q('#visitType').value : !!q('#callType').value;
    }
    if (n === 3) {
      const reqOk = !!q('#custName').value.trim() && /^\d{11}$/.test(el.custContact.value.trim()) && !!q('#custCity').value &&
        !!(q('#custHouseNo')?.value.trim()) && !!q('#custArea').value.trim() && !!q('#custAddress').value.trim();
      const optOk = !!(q('#custStreetNo')?.value.trim()) && !!(q('#custLandmark')?.value.trim());
      return reqOk && optOk;
    }
    if (n === 4) {
      const ct = currentCustType(); const cat = el.packageCategory.value;
      if (!cat) return false;
      const list = (ct && cat) ? PACKAGE_CATALOG[ct.value][cat] : null;
      const pkgOk = list ? !!el.packageInterested.value : !!el.manualPackageName.value.trim();
      const mrc = el.packageMrc.value;
      return pkgOk && mrc !== '' && !isNaN(mrc) && Number(mrc) >= 0;
    }
    if (n === 5) {
      if (!el.soi.value) return false;
      if (el.soi.value === 'Existing Customer') return !!el.soiUserId.value.trim();
      return true;
    }
    if (n === 6) {
      const s = el.status.value; if (!s) return false;
      if (s === 'Matured') {
        if (!el.userId.value.trim()) return false;
        const mc = el.mPkgCat.value; if (!mc) return false;
        const ct2 = currentCustType();
        const list2 = (ct2 && mc) ? PACKAGE_CATALOG[ct2.value][mc] : null;
        const pkOk = list2 ? !!el.mPkgPkg.value : !!el.mManualName.value.trim();
        const mr = el.mPkgMrc.value;
        return pkOk && mr !== '' && !isNaN(mr) && Number(mr) >= 0;
      }
      return true;
    }
    return true;
  }

  function prewarmGPS() {
    if (state.gpsWarmed || !navigator.geolocation) return;
    state.gpsWarmed = true;
    const warm = () => navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 });
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => { if (status.state !== 'denied') warm(); }).catch(warm);
    } else warm();
  }

  function captureGPSForEntry(record) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(record); return; }
      function grab() {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const c = pos.coords;
            const lat = c.latitude.toFixed(6), lng = c.longitude.toFixed(6);
            record.latitude = lat; record.longitude = lng;
            record.gpsAccuracy = c.accuracy != null ? Math.round(c.accuracy) : '';
            record.gpsTimestamp = new Date(pos.timestamp).toISOString();
            record.mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
            resolve(record);
          },
          () => resolve(record),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
        );
      }
      if (navigator.permissions?.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((status) => { if (status.state === 'denied') resolve(record); else grab(); }).catch(grab);
      } else grab();
    });
  }

  el.submitBtn.addEventListener('click', handleSubmit);
  async function handleSubmit() {
    if (!validateStep(6)) { goToStep(6); return; }
    const pkgName = getPkgName();
    const ct = currentCustType();
    const cm = root.querySelector('input[name="contactMode"]:checked');
    const isMatured = el.status.value === 'Matured';

    const record = {
      date: state.serverDateTime.date, time: state.serverDateTime.time,
      crmId, empName, sapNumber, city: q('#custCity').value, mobileNumber, email,
      customerType: ct.value,
      contactMode: cm.value,
      visitType: cm.value === 'Visit' ? q('#visitType').value : q('#callType').value,
      customerName: q('#custName').value.trim(),
      customerContact: el.custContact.value.trim(),
      address: q('#custAddress').value.trim(),
      packageCategory: isMatured && el.mPkgCat.value ? el.mPkgCat.value : el.packageCategory.value,
      packageInterested: isMatured && (el.mPkgPkg.value || el.mManualName.value.trim()) ? (el.mPkgPkg.value || el.mManualName.value.trim()) : pkgName,
      mrc: isMatured && el.mPkgMrc.value ? Number(el.mPkgMrc.value) || 0 : Number(el.packageMrc.value) || 0,
      soi: el.soi.value, status: el.status.value,
      userId: isMatured ? el.userId.value.trim() : (el.soi.value === 'Existing Customer' ? el.soiUserId.value.trim() : ''),
      selectedPackage: isMatured ? (el.mPkgPkg.value || el.mManualName.value.trim() || pkgName) : '',
      brochuresDropped: parseInt(el.brochures.value) || 0,
      remarks: q('#remarks').value.trim()
    };
    // Matches the original: submitEntry's `city` column is the customer's
    // city (from the wizard's City field), not the employee's home city —
    // profile.empCity is sent separately and unused by Code.gs's COLUMNS
    // mapping for this field.

    el.submitBtn.disabled = true; el.submitBtn.textContent = 'Submitting...';
    try {
      const withGps = await captureGPSForEntry(record);
      const res = await api.submitEntry(withGps);
      if (res?.queued) {
        toastSuccess(`Visit report for ${record.customerName} queued \u2014 will sync once you're back online.`);
      } else {
        toastSuccess(`Visit report submitted successfully for ${record.customerName}.`);
      }
      resetWizard();
      onSubmitted?.(record);
    } catch (e) {
      toastError('Something went wrong. Check your connection and try again.');
    }
    el.submitBtn.disabled = false; el.submitBtn.innerHTML = '&#10003; Submit';
  }

  function resetWizard() {
    qa('.et-card.sel, .opt.sel').forEach((o) => o.classList.remove('sel'));
    qa('input[type=radio]').forEach((r) => { r.checked = false; });
    ['custName', 'custContact', 'custArea', 'custAddress', 'custHouseNo', 'custStreetNo', 'custLandmark', 'manualPackageName', 'userId', 'soiUserId', 'remarks'].forEach((id) => { const f = q('#' + id); if (f) f.value = ''; });
    q('#custCity').value = ''; q('#visitType').value = ''; q('#callType').value = '';
    qa('#visitTypeCards .et-card, #callTypeCards .et-card').forEach((c) => c.classList.remove('sel'));
    wizUpdateSubType();
    el.soiUserIdWrap.style.display = 'none';
    el.soi.value = ''; el.status.value = ''; el.brochures.value = 0;
    el.mManualName.value = ''; el.mPkgMrc.value = ''; el.mPkgPreview.style.display = 'none';
    populateCategories('');
    goToStep(1);
  }

  return {
    unmount() {
      state.destroyed = true;
      clearTimeout(state.advTimer);
      root.innerHTML = '';
    }
  };
}

function shellHtml() {
  return `
  <div class="am2-hdr" style="margin-top:14px;">
    <div class="am2-hdr-left"><div class="am2-title">DVR / SQ / D2D</div><div class="am2-sub">Daily Visit Report \u00b7 Sales Queue \u00b7 Door-to-Door</div></div>
  </div>
  <div class="card">
    <div class="wizard-head">
      <div class="wh-left">
        <button type="button" class="wback" id="stepBackBtn">&larr;</button>
        <span class="sbadge" id="stepBadge">1</span>
        <span class="wtitle" id="stepTitle">Entry Type</span>
      </div>
    </div>

    <div class="step-panel" data-step="1">
      <p class="hint" style="margin-top:0;">What type of customer are you dealing with?</p>
      <div class="et-grid" id="custType">
        <label class="et-card" data-value="Home"><input type="radio" name="custType" value="Home" style="display:none;"><div class="icon">&#127968;</div><div class="lbl">Home Customer</div></label>
        <label class="et-card" data-value="Corporate"><input type="radio" name="custType" value="Corporate" style="display:none;"><div class="icon">&#127970;</div><div class="lbl">Corporate Customer</div></label>
      </div>
      <div class="ferr" id="err-custType">Please select a customer type.</div>
    </div>

    <div class="step-panel" data-step="2" style="display:none;">
      <label style="margin-top:0;">Interaction Type <span class="req">*</span></label>
      <div class="radio-grid" id="contactMode">
        <label class="opt"><input type="radio" name="contactMode" value="Visit"><span>Visit</span></label>
        <label class="opt"><input type="radio" name="contactMode" value="Call"><span>Call</span></label>
      </div>
      <div class="ferr" id="err-contactMode">Please select an interaction type.</div>
      <div id="visitTypeWrap" style="display:none;">
        <input type="hidden" id="visitType" value="">
        <label style="margin-top:10px;">Visit Type <span class="req">*</span></label>
        <div class="et-grid" id="visitTypeCards">
          <label class="et-card" data-value="New"><div class="icon">&#10024;</div><div class="lbl">New</div></label>
          <label class="et-card" data-value="Follow-up"><div class="icon">&#128260;</div><div class="lbl">Follow-up</div></label>
        </div>
        <div class="ferr" id="err-visitType">Please select a visit type.</div>
      </div>
      <div id="callTypeWrap" style="display:none;">
        <input type="hidden" id="callType" value="">
        <label style="margin-top:10px;">Call Type <span class="req">*</span></label>
        <div class="et-grid" id="callTypeCards">
          <label class="et-card" data-value="New"><div class="icon">&#10024;</div><div class="lbl">New</div></label>
          <label class="et-card" data-value="Follow-up"><div class="icon">&#128260;</div><div class="lbl">Follow-up</div></label>
        </div>
        <div class="ferr" id="err-callType">Please select a call type.</div>
      </div>
    </div>

    <div class="step-panel" data-step="3" style="display:none;">
      <label style="margin-top:0;">Customer Name <span class="req">*</span></label>
      <input type="text" id="custName" placeholder="Enter customer name">
      <div class="ferr">Customer name is required.</div>
      <label>Customer Contact <span class="req">*</span></label>
      <input type="tel" id="custContact" placeholder="03XXXXXXXXX" maxlength="11" inputmode="numeric">
      <div class="hint">Exactly 11 digits.</div>
      <div class="ferr">Enter a valid 11-digit number.</div>
      <div class="dup-warn" id="dupWarn">&#9888; This number already exists \u2014 will be flagged as duplicate.</div>
      <label>City <span class="req">*</span></label>
      <select id="custCity">
        <option value="">Select city</option>
        <option>Faisalabad</option><option>Gujranwala</option><option>Multan</option>
        <option>Muzaffargarh</option><option>Peshawar</option><option>Sargodha</option><option>Sialkot</option>
      </select>
      <div class="ferr" id="err-custCity">Please select a city.</div>
      <label>House No. <span class="req">*</span></label>
      <input type="text" id="custHouseNo" placeholder="e.g. House 12, Flat 3B">
      <div class="ferr" id="err-custHouseNo">House No. is required.</div>
      <label>Street No. <span style="color:var(--ts);font-weight:400;">(optional)</span></label>
      <input type="text" id="custStreetNo" placeholder="e.g. Street 5, Block A">
      <label>Landmark <span style="color:var(--ts);font-weight:400;">(optional)</span></label>
      <input type="text" id="custLandmark" placeholder="e.g. Near Masjid, Opposite Park">
      <label>Area <span class="req">*</span></label>
      <input type="text" id="custArea" placeholder="Enter area / sector / block">
      <div class="ferr" id="err-custArea">Area is required.</div>
      <label>Address <span class="req">*</span></label>
      <textarea id="custAddress" placeholder="House No., Street No. or nearest landmark (City & Area will be added automatically)"></textarea>
      <div class="ferr">Address is required.</div>
    </div>

    <div class="step-panel" data-step="4" style="display:none;">
      <label style="margin-top:0;">Package Category <span class="req">*</span></label>
      <select id="packageCategory" disabled><option value="">Select customer type first</option></select>
      <div class="ferr">Please select a package category.</div>
      <label>Select Package <span class="req">*</span></label>
      <select id="packageInterested" disabled><option value="">Select a category first</option></select>
      <div id="manualPackageWrap" style="display:none;">
        <label>Package Name <span class="req">*</span></label>
        <input type="text" id="manualPackageName" placeholder="Enter package name">
        <div class="ferr">Package name is required.</div>
      </div>
      <div class="ferr">Please select a package.</div>
      <label>MRC (PKR) <span class="req">*</span></label>
      <input type="number" id="packageMrc" min="0" placeholder="Auto-filled when package selected">
      <div class="ferr">Please enter the MRC.</div>
      <div class="pkg-preview" id="pkgPreview" style="display:none;">
        <div class="pp-lbl">Package</div><div class="pp-name" id="ppName">-</div>
        <div class="pp-row"><span>Type</span><b id="ppType">-</b></div>
        <div class="pp-row"><span>MRC</span><b id="ppMrc">-</b></div>
      </div>
    </div>

    <div class="step-panel" data-step="5" style="display:none;">
      <label style="margin-top:0;">Source of Information (SOI) <span class="req">*</span></label>
      <select id="soi">
        <option value="">Select source</option>
        <option>D2D \u2013 Door-to-Door</option><option>Customer Referral</option><option>Employee Referral</option>
        <option>Social Media</option><option>Marketing Campaign</option><option>Existing Customer</option>
      </select>
      <div class="ferr">Please select a source.</div>
      <div id="soiUserIdWrap" style="display:none;margin-top:12px;">
        <label>User ID <span class="req">*</span></label>
        <input type="text" id="soiUserId" placeholder="Enter existing customer User ID">
        <div class="ferr" id="err-soiUserId">User ID is required for Existing Customer.</div>
      </div>
    </div>

    <div class="step-panel" data-step="6" style="display:none;">
      <label style="margin-top:0;">Select Status <span class="req">*</span></label>
      <select id="status">
        <option value="">Select status</option>
        <option>Matured</option><option>Follow-Up Required</option><option>Pending Due to Customer</option>
        <option>Not Interested</option><option>Not in Coverage Area</option><option>Satisfied with Existing ISP</option>
      </select>
      <div class="ferr">Please select a status.</div>
      <div class="mature-box" id="matureBox" style="display:none;">
        <label style="margin-top:8px;">User ID <span class="req">*</span></label>
        <input type="text" id="userId" placeholder="Enter User ID">
        <div class="ferr" id="err-userId">User ID is required for Matured status.</div>
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--br);">
        <label style="font-size:13px;font-weight:700;color:var(--nb);">Package Information</label>
        <label style="margin-top:10px;">Package Category <span class="req">*</span></label>
        <select id="mPkgCat" disabled><option value="">Select customer type first</option></select>
        <div class="ferr" id="err-mPkgCat">Please select a package category.</div>
        <label>Select Package <span class="req">*</span></label>
        <select id="mPkgPkg" disabled><option value="">Select a category first</option></select>
        <div id="mManualWrap" style="display:none;">
          <label>Package Name <span class="req">*</span></label>
          <input type="text" id="mManualName" placeholder="Enter package name">
          <div class="ferr" id="err-mManualName">Package name is required.</div>
        </div>
        <div class="ferr" id="err-mPkgPkg">Please select a package.</div>
        <label>MRC (PKR) <span class="req">*</span></label>
        <input type="number" id="mPkgMrc" min="0" placeholder="Auto-filled when package selected">
        <div class="ferr" id="err-mPkgMrc">Please enter the MRC.</div>
        <div class="pkg-preview" id="mPkgPreview" style="display:none;">
          <div class="pp-lbl">Package</div><div class="pp-name" id="mPpName">-</div>
          <div class="pp-row"><span>Category</span><b id="mPpType">-</b></div>
          <div class="pp-row"><span>MRC</span><b id="mPpMrc">-</b></div>
        </div>
      </div>
    </div>

    <div class="step-panel" data-step="7" style="display:none;">
      <label style="margin-top:0;">Remarks</label>
      <textarea id="remarks" placeholder="Add any additional notes about this visit..."></textarea>
    </div>

    <div class="step-panel" data-step="8" style="display:none;">
      <label style="margin-top:0;">Number of Brochures Dropped <span class="req">*</span></label>
      <div class="brochure-row">
        <button type="button" id="brochMinus">-</button>
        <input type="number" id="brochures" value="0" min="0">
        <button type="button" id="brochPlus">+</button>
      </div>
      <div class="info-note">&#9432; Brochures are counted only for Physical Visits.</div>
    </div>

    <div class="step-prog">Step <span id="stepNum">1</span> of 8</div>
    <div class="step-dots" id="stepDots"></div>
    <div class="wnav">
      <a id="skipBtn" style="display:none;cursor:pointer;font-size:13px;color:var(--nb);text-decoration:none;padding:8px 4px;opacity:.75;">Continue without remarks &rarr;</a>
      <button type="button" class="btn btn-sub" id="submitBtn" style="display:none;">&#10003; Submit</button>
    </div>
  </div>
  <div class="footer-note">Date and time are set automatically by the server.</div>
  `;
}
