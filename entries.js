// ============================================================================
// pages/entries.js
// Ported from the original am2* functions in Index.html (Account Management).
// Same table, same modals, same CSV bulk upload/export format; now scoped to
// a mount root, reading through api.js so a page of entries viewed once is
// available offline, and edits made offline queue via services/sync.js
// exactly like a new wizard submission does.
// ============================================================================
import { api } from '../services/api.js';
import { renderListSkeleton } from '../components/loader.js';
import { showToast, toastSuccess, toastError } from '../components/toast.js';
import { escapeHtml } from '../utils/helpers.js';
import { PACKAGE_CATALOG, formatPkr } from '../utils/constants.js';

export function mountEntriesPage(root, { crmId } = {}) {
  root.innerHTML = shellHtml();
  const q = (sel) => root.querySelector(sel);

  const state = {
    page: 1, pageSize: 50, total: 0, totalPages: 1,
    sortCol: 'date', sortAsc: false,
    loading: false, searchTimer: null,
    canEdit: false, canDelete: false, isSup: false, isAdmin: false, role: '',
    entries: [], curEntry: null, curRowIdx: null,
    pendingApprovals: [],
    destroyed: false
  };

  const el = {
    search: q('#am2Search'), clr: q('#am2Clr'), city: q('#am2City'), from: q('#am2From'), to: q('#am2To'),
    emp: q('#am2Emp'), type: q('#am2Type'), soi: q('#am2Soi'), status: q('#am2Status'), dvrType: q('#am2DvrType'),
    count: q('#am2Count'), rolePill: q('#am2RolePill'), uploadBtn: q('#am2UploadBtn'),
    loadingEl: q('#am2Loading'), wrap: q('#am2Wrap'), tbody: q('#am2Tbody'), pageEl: q('#am2Page'),
    pendBanner: q('#am2PendBanner'), pendText: q('#am2PendText'),
    viewModal: q('#am2ViewModal'), viewBody: q('#am2ViewBody'),
    editModal: q('#am2EditModal'), editBody: q('#am2EditBody'), editSave: q('#am2EditSave'), apprNote: q('#am2ApprNote')
  };

  // ---- wiring ----
  el.search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    el.clr.style.display = el.search.value ? 'block' : 'none';
    state.searchTimer = setTimeout(() => fetchEntries(1), 400);
  });
  el.clr.addEventListener('click', () => { el.search.value = ''; el.clr.style.display = 'none'; fetchEntries(1); });
  [el.city, el.from, el.to, el.emp, el.type, el.soi, el.status, el.dvrType].forEach((sel) => sel.addEventListener('change', () => fetchEntries(1)));
  q('#am2ExportBtn').addEventListener('click', exportCsv);
  q('#am2NewBtn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('nsms:navigate', { detail: { view: 'wizard' } })));
  el.uploadBtn.addEventListener('click', showUploadModal);
  q('#am2ReviewBtn').addEventListener('click', reviewApprovals);
  root.querySelectorAll('.am2-th-sort').forEach((th) => th.addEventListener('click', () => sortBy(th.dataset.sort)));
  el.viewModal.addEventListener('click', (e) => { if (e.target === el.viewModal) closeModal(el.viewModal); });
  el.editModal.addEventListener('click', (e) => { if (e.target === el.editModal) closeModal(el.editModal); });
  q('#am2ViewClose').addEventListener('click', () => closeModal(el.viewModal));
  q('#am2ViewClose2').addEventListener('click', () => closeModal(el.viewModal));
  q('#am2EditClose').addEventListener('click', () => closeModal(el.editModal));
  q('#am2EditCancel').addEventListener('click', () => closeModal(el.editModal));
  el.editSave.addEventListener('click', saveEdit);

  function closeModal(modalEl) { modalEl.style.display = 'none'; }

  // ---- fetch ----
  async function fetchEntries(page) {
    if (state.loading) return;
    state.loading = true;
    el.loadingEl.innerHTML = renderListSkeleton(6);
    el.loadingEl.style.display = 'block';
    el.wrap.style.display = 'none';
    state.page = page || state.page;

    const params = {
      search: el.search.value.trim(), city: el.city.value, fromDate: el.from.value, toDate: el.to.value,
      employeeCrmId: el.emp.value, type: el.type.value, soi: el.soi.value, status: el.status.value,
      page: state.page, pageSize: state.pageSize, dvrType: el.dvrType.value || ''
    };

    try {
      const d = await api.getMyEntries(crmId, params);
      el.loadingEl.style.display = 'none';
      if (!d || d.error) { showToast(d?.error || 'Failed to load entries.', { type: 'error' }); state.loading = false; return; }

      state.entries = d.entries || [];
      state.total = d.total || 0;
      state.totalPages = d.totalPages || 1;
      state.page = d.page || 1;
      state.canEdit = !!d.canEdit;
      state.canDelete = !!d.canDelete;
      state.isSup = !!d.isSupervisor;
      state.isAdmin = !!d.isAdmin;
      state.role = d.role || '';

      const roleLabels = { Employee: 'My View', Supervisor: 'Team View', 'Regional Manager': 'Regional View' };
      el.rolePill.textContent = '● ' + (roleLabels[d.role] || d.role || 'My View');
      el.uploadBtn.style.display = (state.isSup || state.isAdmin) ? 'flex' : 'none';
      el.emp.style.display = (state.isSup || state.isAdmin) ? 'block' : 'none';

      if (d.filters) {
        const f = d.filters;
        if (f.cities) populateSelect(el.city, f.cities);
        if (f.types) populateSelect(el.type, f.types);
        if (f.sois) populateSelect(el.soi, f.sois);
        if (f.statuses) populateSelect(el.status, f.statuses);
        if (f.employees && (state.isSup || state.isAdmin)) {
          populateSelect(el.emp, f.employees, true);
        }
      }

      state.entries.sort((a, b) => {
        const av = a[state.sortCol] || '', bv = b[state.sortCol] || '';
        const r = String(av).localeCompare(String(bv));
        return state.sortAsc ? r : -r;
      });

      render();

      const canApprove = state.isSup || state.isAdmin || state.canDelete || state.role === 'Regional Manager';
      if (canApprove) checkPending(); else el.pendBanner.style.display = 'none';
    } catch (err) {
      el.loadingEl.style.display = 'none';
      showToast('Error: ' + (err.message || err), { type: 'error' });
    }
    state.loading = false;
  }

  function populateSelect(selectEl, list, isEmp) {
    const prev = selectEl.value;
    while (selectEl.options.length > 1) selectEl.remove(1);
    list.forEach((x) => {
      const o = document.createElement('option');
      o.value = isEmp ? x.crmId : x;
      o.textContent = isEmp ? `${x.name} (${x.city})` : x;
      selectEl.appendChild(o);
    });
    if (prev) selectEl.value = prev;
  }

  function sortBy(col) {
    if (state.sortCol === col) state.sortAsc = !state.sortAsc;
    else { state.sortCol = col; state.sortAsc = false; }
    root.querySelectorAll('.am2-sort-ico').forEach((ic) => { ic.className = 'am2-sort-ico'; });
    const th = root.querySelector(`.am2-th-sort[data-sort="${col}"] .am2-sort-ico`);
    if (th) th.className = 'am2-sort-ico ' + (state.sortAsc ? 'asc' : 'desc');
    state.entries.sort((a, b) => {
      const av = a[col] || '', bv = b[col] || '';
      const r = String(av).localeCompare(String(bv));
      return state.sortAsc ? r : -r;
    });
    render();
  }

  // ---- render table ----
  function badgeClass(status) {
    const l = (status || '').toLowerCase();
    if (l.includes('matur') || l === 'installed') return 'am2-badge-mature';
    if (l.includes('pdtc')) return 'am2-badge-pdtc';
    if (l.includes('not interest') || l.includes('not req') || l.includes('cancel')) return 'am2-badge-ni';
    if (l.includes('follow') || l.includes('pending')) return 'am2-badge-fu';
    if (l.includes('not respond') || l.includes('not avail')) return 'am2-badge-nr';
    return 'am2-badge-other';
  }

  function render() {
    const { entries, total, page, pageSize } = state;
    const offset = (page - 1) * pageSize;
    el.count.innerHTML = `Showing <b>${entries.length ? offset + 1 : 0}–${offset + entries.length}</b> of <b>${total.toLocaleString()}</b> entries`;

    if (!entries.length) {
      el.tbody.innerHTML = `<tr><td colspan="10"><div class="am2-empty"><span class="material-icons">inbox</span>No entries found for selected filters.</div></td></tr>`;
      el.wrap.style.display = 'block';
      renderPagination();
      return;
    }

    el.tbody.innerHTML = entries.map((e, i) => {
      const isDup = e.isDuplicate;
      let sBadge = `<span class="am2-badge ${badgeClass(e.status)}">${escapeHtml(e.status || '—')}</span>`;
      if (isDup) sBadge += '<span class="am2-badge am2-badge-dup">DUPLICATE</span>';

      let acts = `<div class="am2-acts"><button class="am2-act am2-act-view" data-act="view" data-idx="${i}" title="View"><span class="material-icons">visibility</span></button>`;
      if (state.canEdit) acts += `<button class="am2-act am2-act-edit" data-act="edit" data-idx="${i}" title="Edit"><span class="material-icons">edit</span></button>`;
      if (state.canDelete) acts += `<button class="am2-act am2-act-del" data-act="del" data-idx="${i}" title="Delete"><span class="material-icons">delete</span></button>`;
      acts += '</div>';

      return `<tr class="${isDup ? 'am2-dup' : ''}">
        <td class="am2-td-muted" style="text-align:center;">${offset + i + 1}</td>
        <td class="am2-td-bold" style="white-space:nowrap;">${escapeHtml(e.date || '—')}</td>
        <td style="color:var(--nb);font-weight:600;font-size:12.5px;">${escapeHtml(e.empName || e.crmId || '—')}</td>
        <td>${escapeHtml(e.city || '—')}</td>
        <td class="am2-td-bold" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.customerName || '—')}</td>
        <td class="am2-td-mono">${escapeHtml(e.contact || '—')}</td>
        <td class="am2-td-muted">${escapeHtml(e.address || '—')}</td>
        <td class="am2-td-muted">${escapeHtml(e.soi || '—')}</td>
        <td>${sBadge}</td>
        <td>${acts}</td>
      </tr>`;
    }).join('');

    el.tbody.querySelectorAll('[data-act]').forEach((btn) => {
      const idx = Number(btn.dataset.idx);
      btn.addEventListener('click', () => {
        if (btn.dataset.act === 'view') viewEntry(idx);
        if (btn.dataset.act === 'edit') editEntry(idx);
        if (btn.dataset.act === 'del') deleteEntryAt(idx);
      });
    });

    el.wrap.style.display = 'block';
    renderPagination();
  }

  function renderPagination() {
    const { page, totalPages } = state;
    if (totalPages <= 1) { el.pageEl.innerHTML = ''; return; }
    const info = `<div class="am2-page-info">Page <b>${page}</b> of <b>${totalPages}</b></div>`;
    let btns = '<div class="am2-page-btns">';
    const pageBtn = (p, label, disabled) => `<button class="am2-pbtn" data-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    btns += pageBtn(1, '&laquo;', page === 1);
    btns += pageBtn(page - 1, '&lsaquo;', page === 1);
    const start = Math.max(1, page - 2), end = Math.min(totalPages, page + 2);
    for (let p = start; p <= end; p++) btns += `<button class="am2-pbtn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
    btns += pageBtn(page + 1, '&rsaquo;', page === totalPages);
    btns += pageBtn(totalPages, '&raquo;', page === totalPages);
    btns += '</div>';
    el.pageEl.innerHTML = info + btns;
    el.pageEl.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => fetchEntries(Number(btn.dataset.page))));
  }

  // ---- view modal ----
  function viewEntry(idx) {
    const e = state.entries[idx]; if (!e) return;
    const fields = [
      ['Date', e.date], ['Sales Executive', e.empName || e.crmId], ['City', e.city],
      ['Customer Name', e.customerName], ['Mobile', e.contact], ['Email', e.customerEmail || '—'],
      ['Address', e.address], ['Customer Type', e.customerType], ['Interaction Type', e.contactMode],
      ['Visit Type', e.visitType], ['SOI', e.soi], ['Status', e.status],
      ['Package Category', e.packageCategory], ['Package Interested', e.packageInterested],
      ['MRC', e.mrc ? formatPkr(e.mrc) : '—'], ['Remarks', e.remarks || '—']
    ];
    if (state.isAdmin && (e.latitude || e.longitude || e.mapsUrl)) {
      fields.push(['Latitude', e.latitude || '—'], ['Longitude', e.longitude || '—'],
        ['GPS Accuracy', e.gpsAccuracy ? e.gpsAccuracy + ' m' : '—'], ['GPS Timestamp', e.gpsTimestamp || '—']);
    }
    const mapsLink = (state.isAdmin && e.mapsUrl)
      ? `<div class="am2-detail-item" style="grid-column:1/-1;"><label>Maps URL</label><span><a href="${escapeHtml(e.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a></span></div>` : '';
    el.viewBody.innerHTML = `<div class="am2-detail-grid">${
      fields.map((f) => `<div class="am2-detail-item"><label>${escapeHtml(f[0])}</label><span>${escapeHtml(String(f[1] || '—'))}</span></div>`).join('')
    }${mapsLink}</div>${
      e.isDuplicate ? `<div class="am2-dup-notice"><b>⚠ Duplicate:</b> This contact number already exists in other entries.</div>` : ''
    }`;
    el.viewModal.style.display = 'flex';
  }

  // ---- edit modal ----
  function editEntry(idx) {
    const e = state.entries[idx]; if (!e) return;
    state.curEntry = e; state.curRowIdx = idx;
    const isAdmin = state.isAdmin;
    el.apprNote.style.display = isAdmin ? 'none' : 'flex';
    el.editSave.textContent = isAdmin ? 'Save Changes' : 'Submit for Approval';

    const statuses = ['Follow-Up Required', 'Matured', 'Not Interested', 'Pending Due to Customer', 'Not in Coverage Area', 'Satisfied with existing ISP'];
    el.editBody.innerHTML = `
      <div class="am2-form-group"><label>Status</label>
        <select id="efStatus">${statuses.map((s) => `<option${e.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
      </div>
      <div id="efMaturedBox" style="display:none;margin-top:12px;">
        <div class="am2-form-group"><label>User ID</label><input id="efUserId" value="${escapeHtml(e.userId || '')}" placeholder="Enter User ID"></div>
        <div class="am2-form-group" style="margin-top:12px;"><label>Package Category</label><select id="efPkgCat"><option value="">Select category</option></select></div>
        <div class="am2-form-group" style="margin-top:12px;"><label>Select Package</label><select id="efPkgPkg" disabled><option value="">Select a category first</option></select></div>
        <div class="am2-form-group" id="efManualWrap" style="display:none;margin-top:12px;"><label>Package Name</label><input id="efManualName" placeholder="Enter package name"></div>
        <div class="am2-form-group" style="margin-top:12px;"><label>MRC (PKR)</label><input type="number" id="efMrc" min="0" placeholder="Auto-filled when package selected" value="${escapeHtml(e.mrc || '')}"></div>
      </div>
      <div class="am2-form-group" style="margin-bottom:0;margin-top:12px;"><label>Remarks</label><textarea id="efRemarks">${escapeHtml(e.remarks || '')}</textarea></div>
    `;

    const efStatus = el.editBody.querySelector('#efStatus');
    const efMaturedBox = el.editBody.querySelector('#efMaturedBox');
    const efPkgCat = el.editBody.querySelector('#efPkgCat');
    const efPkgPkg = el.editBody.querySelector('#efPkgPkg');
    const efManualWrap = el.editBody.querySelector('#efManualWrap');
    const efManualName = el.editBody.querySelector('#efManualName');
    const efMrc = el.editBody.querySelector('#efMrc');

    function resetPkgFields() {
      const ct = (e.customerType || '').trim();
      const catKey = Object.keys(PACKAGE_CATALOG).find((k) => k.toLowerCase() === ct.toLowerCase());
      if (!catKey) { efPkgCat.innerHTML = '<option value="">Select category</option>'; return; }
      efPkgCat.innerHTML = '<option value="">Select category</option>' +
        Object.keys(PACKAGE_CATALOG[catKey]).map((c) => `<option${e.packageCategory === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
      if (e.packageCategory) onCatChange(true);
    }
    function onCatChange(keepPkg) {
      const ct = (e.customerType || '').trim();
      const catKey = Object.keys(PACKAGE_CATALOG).find((k) => k.toLowerCase() === ct.toLowerCase());
      const cat = efPkgCat.value;
      if (!keepPkg) { efManualName.value = ''; efMrc.value = ''; }
      if (!catKey || !cat) { efPkgPkg.disabled = true; efPkgPkg.innerHTML = '<option value="">Select a category first</option>'; efManualWrap.style.display = 'none'; return; }
      const list = PACKAGE_CATALOG[catKey][cat];
      if (list) {
        efPkgPkg.disabled = false; efPkgPkg.style.display = ''; efManualWrap.style.display = 'none';
        efPkgPkg.innerHTML = '<option value="">Select a package</option>' +
          list.map((p) => `<option value="${escapeHtml(p.name)}" data-mrc="${p.mrc}"${(e.packageInterested === p.name || e.selectedPackage === p.name) ? ' selected' : ''}>${escapeHtml(p.name)} - ${formatPkr(p.mrc)}</option>`).join('');
      } else {
        efPkgPkg.disabled = true; efPkgPkg.style.display = 'none'; efManualWrap.style.display = 'block';
        efManualName.value = e.packageInterested || e.selectedPackage || '';
      }
    }
    efPkgCat.addEventListener('change', () => onCatChange(false));
    efPkgPkg.addEventListener('change', () => { const o = efPkgPkg.selectedOptions[0]; if (o?.dataset.mrc) efMrc.value = o.dataset.mrc; });
    efStatus.addEventListener('change', () => {
      const isMatured = efStatus.value === 'Matured';
      efMaturedBox.style.display = isMatured ? 'block' : 'none';
      if (isMatured) resetPkgFields();
    });
    if (efStatus.value === 'Matured') { efMaturedBox.style.display = 'block'; resetPkgFields(); }

    el.editModal.style.display = 'flex';
  }

  async function saveEdit() {
    const e = state.curEntry; if (!e) return;
    const efStatus = el.editBody.querySelector('#efStatus');
    const efRemarks = el.editBody.querySelector('#efRemarks');
    const changes = { status: efStatus.value.trim(), remarks: efRemarks.value.trim() };

    if (changes.status === 'Matured') {
      const uid = el.editBody.querySelector('#efUserId')?.value.trim();
      if (!uid) { showToast('User ID is required for Matured status.', { type: 'error' }); return; }
      const pkgSel = el.editBody.querySelector('#efPkgPkg')?.value;
      const manualName = el.editBody.querySelector('#efManualName')?.value.trim();
      const pkgName = pkgSel || manualName;
      if (!pkgName) { showToast('Please select or enter a package.', { type: 'error' }); return; }
      const mrcVal = el.editBody.querySelector('#efMrc')?.value;
      if (mrcVal === '' || isNaN(mrcVal)) { showToast('Please enter the MRC.', { type: 'error' }); return; }
      changes.userId = uid;
      changes.packageCategory = el.editBody.querySelector('#efPkgCat')?.value || '';
      changes.packageInterested = pkgName;
      changes.selectedPackage = pkgName;
      changes.mrc = Number(mrcVal) || 0;
    }

    el.editSave.disabled = true;
    el.editSave.textContent = 'Saving…';
    try {
      const res = state.isAdmin
        ? await api.applyEditDirect(crmId, e.rowIndex, changes)
        : await api.submitEditRequest(crmId, e.rowIndex, changes, e);
      if (!res || res.error) throw new Error(res?.error || 'Failed');
      if (res.queued) {
        toastSuccess('Edit queued — will apply once you\'re back online.');
      } else {
        toastSuccess(state.isAdmin ? 'Entry updated.' : 'Edit submitted for approval.');
      }
      closeModal(el.editModal);
      fetchEntries(state.page);
    } catch (err) {
      toastError('Error: ' + (err.message || err));
    }
    el.editSave.disabled = false;
    el.editSave.textContent = state.isAdmin ? 'Save Changes' : 'Submit for Approval';
  }

  // ---- delete ----
  async function deleteEntryAt(idx) {
    const e = state.entries[idx]; if (!e) return;
    if (!confirm(`Delete entry for "${e.customerName}"?\nThis cannot be undone.`)) return;
    try {
      const res = await api.deleteEntry(crmId, e.rowIndex);
      if (!res || res.error) throw new Error(res?.error || 'Failed');
      toastSuccess(res.queued ? 'Delete queued for when you\'re back online.' : 'Entry deleted.');
      fetchEntries(state.page);
    } catch (err) {
      toastError('Error: ' + (err.message || err));
    }
  }

  // ---- pending approvals ----
  async function checkPending() {
    try {
      const d = await api.getPendingApprovals(crmId);
      if (d?.error) { el.pendBanner.style.display = 'none'; return; }
      if (d?.ok && d.pending?.length) {
        el.pendText.textContent = `${d.pending.length} edit request${d.pending.length > 1 ? 's' : ''} pending your approval.`;
        el.pendBanner.style.display = 'flex';
      } else {
        el.pendBanner.style.display = 'none';
      }
    } catch (e) { /* non-fatal */ }
  }

  let approvalModal = null;
  async function reviewApprovals() {
    if (!approvalModal) {
      approvalModal = document.createElement('div');
      approvalModal.className = 'am2-overlay';
      approvalModal.innerHTML = `
        <div class="am2-modal" style="max-width:600px;">
          <div class="am2-modal-hd">
            <div class="am2-modal-hd-title"><span class="material-icons">rule</span>Pending Edit Approvals</div>
            <button class="am2-modal-close" id="am2ApprCloseBtn">✕</button>
          </div>
          <div class="am2-modal-body" id="am2ApprovalBody"></div>
          <div class="am2-modal-foot"><button class="am2-btn am2-btn-sec" id="am2ApprCloseBtn2">Close</button></div>
        </div>`;
      root.appendChild(approvalModal);
      approvalModal.addEventListener('click', (e) => { if (e.target === approvalModal) approvalModal.style.display = 'none'; });
      approvalModal.querySelector('#am2ApprCloseBtn').addEventListener('click', () => approvalModal.style.display = 'none');
      approvalModal.querySelector('#am2ApprCloseBtn2').addEventListener('click', () => approvalModal.style.display = 'none');
    }
    approvalModal.style.display = 'flex';
    const body = approvalModal.querySelector('#am2ApprovalBody');
    body.innerHTML = `<div class="am2-loading"><p>Loading requests…</p></div>`;
    try {
      const d = await api.getPendingApprovals(crmId);
      if (!d || d.error) { body.innerHTML = `<div class="am2-empty">${escapeHtml(d?.error || 'Failed to load.')}</div>`; return; }
      state.pendingApprovals = d.pending || [];
      renderApprovals(body);
    } catch (err) {
      body.innerHTML = `<div class="am2-empty">Error: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  function renderApprovals(body) {
    if (!state.pendingApprovals.length) { body.innerHTML = `<div class="am2-empty"><span class="material-icons">check_circle</span>No pending edit requests.</div>`; return; }
    const labels = { customerName: 'Customer Name', contact: 'Mobile', address: 'Address', city: 'City', status: 'Status', soi: 'SOI', remarks: 'Remarks' };
    body.innerHTML = state.pendingApprovals.map((p) => {
      let orig = {}, chg = {};
      try { orig = JSON.parse(p.original || '{}'); } catch (e) {}
      try { chg = JSON.parse(p.changes || '{}'); } catch (e) {}
      const rowsHtml = Object.keys(chg).map((k) => {
        const oldV = orig[k] !== undefined ? String(orig[k]) : '';
        const newV = String(chg[k] || '');
        if (String(oldV) === String(newV)) return '';
        return `<div class="am2-appr-row"><div class="am2-appr-field">${escapeHtml(labels[k] || k)}</div><div class="am2-appr-old">${escapeHtml(oldV || '—')}</div><div class="am2-appr-new">${escapeHtml(newV || '—')}</div></div>`;
      }).join('');
      return `<div class="am2-appr-card">
        <div class="am2-appr-hd"><div class="am2-appr-by">Requested by: ${escapeHtml(p.requestedBy)}</div><div class="am2-appr-date">${escapeHtml(p.requestDate)}</div></div>
        <div class="am2-appr-cols"><div>Field</div><div>Current</div><div>Proposed</div></div>
        ${rowsHtml || `<div class="am2-appr-none">No field changes.</div>`}
        <div class="am2-appr-acts">
          <button class="am2-btn am2-btn-sec" data-reject="${escapeHtml(p.requestId)}"><span class="material-icons">close</span>Reject</button>
          <button class="am2-btn am2-btn-pri" style="background:#1a7a42;" data-approve="${escapeHtml(p.requestId)}"><span class="material-icons">check</span>Approve</button>
        </div></div>`;
    }).join('');
    body.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => approveReq(btn.dataset.approve, body)));
    body.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => rejectReq(btn.dataset.reject, body)));
  }

  async function approveReq(requestId, body) {
    try {
      const res = await api.approveEditRequest(crmId, requestId);
      if (!res || res.error) throw new Error(res?.error || 'Failed');
      toastSuccess('Edit approved. Changes applied.');
      state.pendingApprovals = state.pendingApprovals.filter((p) => p.requestId !== requestId);
      renderApprovals(body);
      checkPending();
      fetchEntries(state.page);
    } catch (err) { toastError('Error: ' + (err.message || err)); }
  }
  async function rejectReq(requestId, body) {
    if (!confirm('Reject this edit request? The original data will remain unchanged.')) return;
    try {
      const res = await api.rejectEditRequest(crmId, requestId, '');
      if (!res || res.error) throw new Error(res?.error || 'Failed');
      toastSuccess('Edit request rejected.');
      state.pendingApprovals = state.pendingApprovals.filter((p) => p.requestId !== requestId);
      renderApprovals(body);
      checkPending();
    } catch (err) { toastError('Error: ' + (err.message || err)); }
  }

  // ---- bulk upload (admin only) ----
  const UPLOAD_HEADERS = ['Date', 'Time', 'CRM ID', 'Employee Name', 'SAP Number', 'City', 'Mobile Number', 'Email', 'Customer Type', 'Interaction Type', 'Visit Type', 'Customer Name', 'Customer Contact', 'Customer Email', 'Address', 'Package Category', 'Package Interested', 'MRC', 'SOI', 'Status', 'User ID', 'Selected Package', 'Brochures Dropped', 'Remarks'];

  let uploadModal = null;
  function showUploadModal() {
    if (!uploadModal) {
      uploadModal = document.createElement('div');
      uploadModal.className = 'am2-overlay';
      uploadModal.innerHTML = `
        <div class="am2-modal" style="max-width:520px;">
          <div class="am2-modal-hd">
            <div class="am2-modal-hd-title"><span class="material-icons">upload_file</span>Bulk Upload Entries</div>
            <button class="am2-modal-close" id="am2UpClose">✕</button>
          </div>
          <div class="am2-modal-body">
            <div class="am2-upload-hint">Upload a CSV file. Row 1 must contain these exact headers:
              <div class="am2-upload-headers">${UPLOAD_HEADERS.join(' | ')}</div>
              <button class="am2-btn am2-btn-sec" id="am2SampleBtn"><span class="material-icons">description</span>Download Sample CSV</button>
            </div>
            <input type="file" id="am2CsvFile" accept=".csv" class="am2-file-input">
            <div id="am2UploadStatus" style="margin-top:12px;font-size:12.5px;"></div>
          </div>
          <div class="am2-modal-foot">
            <button class="am2-btn am2-btn-sec" id="am2UpCancel">Cancel</button>
            <button class="am2-btn am2-btn-pri" id="am2UpGo"><span class="material-icons">cloud_upload</span>Upload</button>
          </div>
        </div>`;
      root.appendChild(uploadModal);
      uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) uploadModal.style.display = 'none'; });
      uploadModal.querySelector('#am2UpClose').addEventListener('click', () => uploadModal.style.display = 'none');
      uploadModal.querySelector('#am2UpCancel').addEventListener('click', () => uploadModal.style.display = 'none');
      uploadModal.querySelector('#am2SampleBtn').addEventListener('click', downloadSampleCsv);
      uploadModal.querySelector('#am2UpGo').addEventListener('click', doUpload);
    }
    uploadModal.querySelector('#am2UploadStatus').innerHTML = '';
    uploadModal.style.display = 'flex';
  }

  function parseCsv(text) {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (inQ) {
        if (c === '"' && n === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  async function doUpload() {
    const fileEl = uploadModal.querySelector('#am2CsvFile');
    const statusEl = uploadModal.querySelector('#am2UploadStatus');
    const btn = uploadModal.querySelector('#am2UpGo');
    if (!fileEl.files?.length) { statusEl.innerHTML = '<span class="am2-err-text">Please choose a CSV file first.</span>'; return; }

    btn.disabled = true; btn.textContent = 'Reading…';
    statusEl.innerHTML = '<span class="am2-muted-text">Reading file…</span>';
    try {
      const text = await fileEl.files[0].text();
      const matrix = parseCsv(text);
      if (matrix.length < 2) {
        statusEl.innerHTML = '<span class="am2-err-text">File has no data rows.</span>';
        resetUploadBtn(btn); return;
      }
      const headers = matrix[0].map((h) => String(h).trim());
      const rows = matrix.slice(1).map((r) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? String(r[i]).trim() : ''; });
        return obj;
      });
      statusEl.innerHTML = `<span class="am2-muted-text">Uploading ${rows.length} rows…</span>`;
      btn.textContent = 'Uploading…';
      const res = await api.bulkUploadEntries(crmId, rows);
      if (!res || res.error) {
        statusEl.innerHTML = `<span class="am2-err-text">${escapeHtml(res?.error || 'Upload failed.')}</span>`;
      } else {
        let msg = `✓ Uploaded ${res.count} row${res.count !== 1 ? 's' : ''} successfully.`;
        if (res.errors?.length) msg += ` (${res.errors.length} row error${res.errors.length !== 1 ? 's' : ''} skipped)`;
        statusEl.innerHTML = `<span class="am2-ok-text">${escapeHtml(msg)}</span>`;
        toastSuccess(`Bulk upload complete: ${res.count} rows added.`);
        setTimeout(() => { uploadModal.style.display = 'none'; fetchEntries(1); }, 1600);
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="am2-err-text">Error: ${escapeHtml(err.message || err)}</span>`;
    }
    resetUploadBtn(btn);
  }
  function resetUploadBtn(btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons">cloud_upload</span>Upload'; }

  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function csvRow(arr) { return arr.map(csvCell).join(','); }

  function downloadSampleCsv() {
    const sample = ['2026-07-05', '10:30 AM', 'ali.raza', 'Ali Raza', '10002131', 'Faisalabad', '03001234567', 'ali.raza@nayatel.com', 'Home', 'Visit', 'New', 'Ahmed Khan', '03211234567', 'ahmed@example.com', 'House 12, Street 5, Gulberg, Faisalabad', 'Home Packages', 'Fiber 25Mbps', '2500', 'D2D - Door to Door', 'Matured', 'FSD-00123', 'Fiber 25Mbps', '50', 'Customer interested, follow-up scheduled'];
    const csv = csvRow(UPLOAD_HEADERS) + '\n' + csvRow(sample);
    downloadBlob('sample_upload_format.csv', csv);
  }

  function entryToRow(e) {
    return [e.date || '', e.time || '', e.crmId || '', e.empName || '', e.sapNumber || '', e.city || '', e.mobile || '', e.email || '',
      e.customerType || '', e.contactMode || '', e.visitType || '', e.customerName || '', e.contact || '', e.customerEmail || '',
      (e.address || '').replace(/\[GPS:[^\]]+\]/, '').trim(), e.packageCategory || '', e.packageInterested || '', e.mrc || 0,
      e.soi || '', e.status || '', e.userId || '', e.selectedPackage || '', e.brochures || 0,
      (e.remarks || '').replace(/\[GPS:[^\]]+\]/, '').trim()];
  }

  function exportCsv() {
    if (!state.entries.length) { showToast('No entries to export.'); return; }
    const dvrType = el.dvrType.value || '';
    const rows = state.entries.filter((e) => {
      if (dvrType === 'Home DVR' && (e.customerType || '').toLowerCase() !== 'home') return false;
      if (dvrType === 'Corporate DVR' && (e.customerType || '').toLowerCase() === 'home') return false;
      return true;
    });
    if (!rows.length) { showToast('No entries match the current filter.'); return; }
    let headers = UPLOAD_HEADERS.slice();
    const withGps = state.isAdmin;
    if (withGps) headers = headers.concat(['Latitude', 'Longitude', 'GPS Accuracy', 'GPS Timestamp', 'Maps URL']);
    const csv = [csvRow(headers)].concat(rows.map((e) => {
      let r = entryToRow(e);
      if (withGps) r = r.concat([e.latitude || '', e.longitude || '', e.gpsAccuracy || '', e.gpsTimestamp || '', e.mapsUrl || '']);
      return csvRow(r);
    })).join('\n');
    downloadBlob(`account_mgmt_${(dvrType || 'all').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function downloadBlob(filename, csv) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- initial load ----
  fetchEntries(1);

  return {
    refresh: () => fetchEntries(state.page),
    unmount() {
      state.destroyed = true;
      clearTimeout(state.searchTimer);
      approvalModal?.remove();
      uploadModal?.remove();
      root.innerHTML = '';
    }
  };
}

// ============================================================================
// Static shell markup
// ============================================================================
function shellHtml() {
  return `
    <div id="am2PendBanner" class="am2-pend-banner" style="display:none;margin-top:14px;">
      <span class="material-icons">pending_actions</span>
      <span id="am2PendText">You have pending edit approvals.</span>
      <button class="am2-btn am2-btn-sec" id="am2ReviewBtn" style="height:28px;font-size:12px;padding:0 10px;">Review</button>
    </div>

    <div class="am2-hdr">
      <div class="am2-hdr-left"><div class="am2-title">Account Management</div><div class="am2-sub">Customer Entries &amp; Lead Tracking</div></div>
      <span class="am2-role-pill" id="am2RolePill">My View</span>
    </div>

    <div class="am2-fbar">
      <div class="am2-fbar-top">
        <div class="am2-search-wrap">
          <span class="material-icons am2-search-ico">search</span>
          <input id="am2Search" class="am2-search" placeholder="Search customer, mobile, address, city, status…">
          <button class="am2-clr" id="am2Clr" style="display:none;">✕</button>
        </div>
        <select id="am2City" class="am2-sel"><option value="">All Cities</option></select>
        <input type="date" id="am2From" class="am2-date" title="From Date">
        <input type="date" id="am2To" class="am2-date" title="To Date">
        <select id="am2Emp" class="am2-sel" style="display:none;"><option value="">All Sales Executives</option></select>
        <select id="am2Type" class="am2-sel"><option value="">Visit Type</option><option>Call</option><option>Visit</option></select>
        <select id="am2Soi" class="am2-sel">
          <option value="">SOI</option><option>D2D - Door to Door</option><option>Reference</option><option>Social Media</option>
          <option>Website</option><option>Walk-in</option><option>Existing Customer</option><option>Marketing Campaign</option><option>Other</option>
        </select>
        <select id="am2Status" class="am2-sel">
          <option value="">Status</option><option>Follow-Up Required</option><option>Matured</option><option>Not Interested</option>
          <option>Not in Coverage Area</option><option>Pending Due to Customer</option><option>Satisfied with existing ISP</option>
        </select>
        <select id="am2DvrType" class="am2-sel" title="Account Management Type">
          <option value="">Account Management</option><option value="Home DVR">Home</option><option value="Corporate DVR">Corporate</option>
        </select>
      </div>
      <div class="am2-fbar-bot">
        <div class="am2-count" id="am2Count"></div>
        <div class="am2-btns">
          <button id="am2UploadBtn" class="am2-btn am2-btn-sec" style="display:none;"><span class="material-icons">upload_file</span>Upload</button>
          <button class="am2-btn am2-btn-sec" id="am2ExportBtn"><span class="material-icons">download</span>Export</button>
          <button class="am2-btn am2-btn-pri" id="am2NewBtn"><span class="material-icons">add</span>New Entry</button>
        </div>
      </div>
    </div>

    <div id="am2Loading" class="am2-loading"></div>

    <div id="am2Wrap" class="am2-wrap" style="display:none;">
      <div class="am2-tbl-scroll">
        <table class="am2-tbl">
          <thead>
            <tr>
              <th style="width:48px;">SR.</th>
              <th class="am2-th-sort" data-sort="date">DATE <span class="am2-sort-ico desc"></span></th>
              <th class="am2-th-sort" data-sort="empName">SALES EXEC. <span class="am2-sort-ico"></span></th>
              <th class="am2-th-sort" data-sort="city">CITY <span class="am2-sort-ico"></span></th>
              <th class="am2-th-sort" data-sort="customerName">CUSTOMER <span class="am2-sort-ico"></span></th>
              <th>MOBILE</th><th>ADDRESS</th><th>SOI</th>
              <th class="am2-th-sort" data-sort="status">STATUS <span class="am2-sort-ico"></span></th>
              <th style="width:90px;text-align:center;">ACTIONS</th>
            </tr>
          </thead>
          <tbody id="am2Tbody"></tbody>
        </table>
      </div>
      <div id="am2Page" class="am2-page"></div>
    </div>

    <div id="am2ViewModal" class="am2-overlay" style="display:none;">
      <div class="am2-modal">
        <div class="am2-modal-hd"><div class="am2-modal-hd-title"><span class="material-icons">person</span>Entry Details</div><button class="am2-modal-close" id="am2ViewClose">✕</button></div>
        <div class="am2-modal-body" id="am2ViewBody"></div>
        <div class="am2-modal-foot"><button class="am2-btn am2-btn-sec" id="am2ViewClose2">Close</button></div>
      </div>
    </div>

    <div id="am2EditModal" class="am2-overlay" style="display:none;">
      <div class="am2-modal">
        <div class="am2-modal-hd"><div class="am2-modal-hd-title"><span class="material-icons">edit</span>Edit Entry</div><button class="am2-modal-close" id="am2EditClose">✕</button></div>
        <div class="am2-modal-body" id="am2EditBody"></div>
        <div class="am2-modal-foot">
          <div class="am2-approval-note" id="am2ApprNote"><span class="material-icons">info</span>Changes will be submitted for supervisor approval.</div>
          <button class="am2-btn am2-btn-sec" id="am2EditCancel">Cancel</button>
          <button class="am2-btn am2-btn-pri" id="am2EditSave"><span class="material-icons">send</span>Submit</button>
        </div>
      </div>
    </div>
  `;
}
