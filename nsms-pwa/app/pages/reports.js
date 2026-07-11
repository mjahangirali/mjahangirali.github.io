// ============================================================================
// pages/reports.js
// Ported from the original rptBuildDvr/rptBuildSq/rptBuildKpi/rptBuildSummary
// + exportReport functions in Index.html. Same grids, same CSV export
// format; now scoped to a mount root instead of global $ ids, and reads
// through api.js (so a report viewed once is available offline via
// api.js's cache fallback, same as the dashboard).
// ============================================================================
import { api } from '../services/api.js';
import { renderCardSkeleton } from '../components/loader.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/helpers.js';

export function mountReportsPage(root, { crmId } = {}) {
  root.innerHTML = shellHtml();
  const q = (sel) => root.querySelector(sel);

  const el = {
    city: q('#rptCity'), month: q('#rptMonth'), year: q('#rptYear'), emp: q('#rptEmp'), type: q('#rptType'),
    loadBtn: q('#rptLoadBtn'), exportBtn: q('#rptExportBtn'),
    spinner: q('#rptSpinner'), cards: q('#rptCards'), staleBanner: q('#rptStaleBanner'),
    cardDvr: q('#rptCardDvr'), cardSq: q('#rptCardSq'), cardKpi: q('#rptCardKpi'), cardSum: q('#rptCardSum'),
    dvrTitle: q('#rptDvrTitle'), sqTitle: q('#rptSqTitle'), kpiTitle: q('#rptKpiTitle'), sumTitle: q('#rptSumTitle'),
    dvrGrid: q('#rptDvrGrid'), sqGrid: q('#rptSqGrid'), kpiGrid: q('#rptKpiGrid'), sumGrid: q('#rptSumGrid')
  };

  const state = { lastData: null, busy: false, destroyed: false };

  // ---- init: seed month/year defaults + filter dropdowns ----
  const now = new Date();
  el.month.value = String(now.getMonth() + 1);
  el.year.value = String(now.getFullYear());
  preloadFilterLists();

  // ---- wiring ----
  el.loadBtn.addEventListener('click', loadReport);
  el.exportBtn.addEventListener('click', exportReport);
  el.type.addEventListener('change', () => showCards(el.type.value));

  async function preloadFilterLists() {
    try {
      const d = await api.getFilterLists(crmId);
      if (d && d.ok) {
        populateSelect(el.city, d.cities, false, 'All Cities', 'All');
        populateSelect(el.emp, d.employees, true, 'All Employees', 'All');
      }
    } catch (e) { /* non-fatal — Load Report will populate from its own response */ }
  }

  function populateSelect(selectEl, list, isEmp, allLabel, allValue) {
    const prev = selectEl.value;
    selectEl.innerHTML = `<option value="${allValue}">${allLabel}</option>`;
    (list || []).forEach((x) => {
      const o = document.createElement('option');
      o.value = isEmp ? x.crmId : x;
      o.textContent = isEmp ? `${x.name} (${x.city})` : x;
      selectEl.appendChild(o);
    });
    if (prev) selectEl.value = prev;
  }

  async function loadReport() {
    if (state.busy) return;
    state.busy = true;
    el.spinner.innerHTML = renderCardSkeleton(120) + renderCardSkeleton(120);
    el.spinner.style.display = 'block';
    el.cards.style.display = 'none';

    const params = {
      city: el.city.value || 'All',
      month: el.month.value,
      year: el.year.value,
      employeeCrmId: el.emp.value || 'All'
    };

    try {
      const d = await api.getCityReport(crmId, params);
      el.spinner.style.display = 'none';
      if (!d) { showToast('No response from server.', { type: 'error' }); state.busy = false; return; }
      if (d.error) { showToast('Report error: ' + d.error, { type: 'error' }); state.busy = false; return; }

      el.staleBanner.style.display = d._stale ? 'flex' : 'none';

      if (d.cityList && d.cityList.length) populateSelect(el.city, d.cityList, false, 'All Cities', 'All');
      if (d.employees && d.employees.length) populateSelect(el.emp, d.employees, true, 'All Employees', 'All');

      const loc = params.city === 'All' ? 'Nationwide' : params.city;
      const lbl = `${loc} — ${d.periodLabel || d.monthLabel + ' ' + d.year}`;
      el.dvrTitle.textContent = 'Daily Visit Report — ' + lbl;
      el.sqTitle.textContent = 'Sales Queue — ' + lbl;
      el.kpiTitle.textContent = 'KPI Summary — ' + lbl;
      el.sumTitle.textContent = loc + ' Summary — ' + (d.periodLabel || d.monthLabel + ' ' + d.year);

      state.lastData = d;
      buildDvr(d);
      buildSq(d);
      buildKpi(d);
      buildSummary(d);

      el.cards.style.display = 'block';
      showCards(el.type.value);
    } catch (err) {
      el.spinner.style.display = 'none';
      showToast('Report failed: ' + (err.message || err), { type: 'error' });
    }
    state.busy = false;
  }

  function showCards(type) {
    const all = [el.cardDvr, el.cardSq, el.cardKpi, el.cardSum];
    const map = { DVR: [el.cardDvr], SQ: [el.cardSq], D2D: [el.cardSum], KPI: [el.cardKpi], Summary: [el.cardSum], All: all };
    const show = map[type] || all;
    all.forEach((c) => { c.style.display = show.includes(c) ? 'block' : 'none'; });
  }

  // ---- grid builders (ported 1:1 from the original rptHead/rptBuildDvr/etc) ----
  function rptHead(d, extraCols, titleOverride) {
    const totalCols = 2 + extraCols.length + d.days.length;
    const titleText = titleOverride || d.periodLabel || (d.monthLabel + ' ' + d.year);
    const titleRow = `<tr><th class="rpt-th-sn rpt-th-title" colspan="${totalCols}">${escapeHtml(titleText)}</th></tr>`;

    const wd1 = d.days.map((day) => {
      const cls = d.isWeekend[day] ? 'rpt-th-day rpt-th-we' : 'rpt-th-day';
      return `<th class="${cls}">${d.dayNames[day]}</th>`;
    }).join('');
    const extraH = extraCols.map((c) => `<th class="rpt-th-main">${c.h}</th>`).join('');
    const row1 = `<tr><th class="rpt-th-sn rpt-th-main">S/No</th><th class="rpt-th-name rpt-th-main">Name</th>${extraH}${wd1}</tr>`;

    const wd2 = d.days.map((day) => {
      const cls = d.isWeekend[day] ? 'rpt-th-day rpt-th-we' : 'rpt-th-day';
      const lbl = d.dayLabels ? d.dayLabels[day] : day;
      return `<th class="${cls}">${lbl}</th>`;
    }).join('');
    const extraH2 = extraCols.map(() => '<th class="rpt-th-main"></th>').join('');
    const row2 = `<tr><th class="rpt-th-sn rpt-th-main"></th><th class="rpt-th-name rpt-th-main"></th>${extraH2}${wd2}</tr>`;

    return `<thead>${titleRow}${row1}${row2}</thead>`;
  }

  function buildDvr(d) {
    const emps = d.reportEmployees && d.reportEmployees.length ? d.reportEmployees : d.employees;
    const dayTotals = {}; d.days.forEach((x) => { dayTotals[x] = 0; });
    let grandTotal = 0, avgSum = 0;

    const bodyRows = emps.map((emp, idx) => {
      const tot = d.empTotals[emp.crmId] || {};
      const empTotal = tot.dvr || 0;
      const empAvg = (tot.avgDvr || 0).toFixed(2);
      grandTotal += empTotal; avgSum += tot.avgDvr || 0;
      const cells = d.days.map((day) => {
        const v = (d.dvrGrid[emp.crmId] || {})[day] || 0;
        dayTotals[day] += v;
        return d.isWeekend[day] ? '<td class="rpt-td-we"></td>' : `<td>${v || ''}</td>`;
      }).join('');
      return `<tr>
        <td class="rpt-sticky-sn">${idx + 1}</td>
        <td class="rpt-sticky-name rpt-td-name">${escapeHtml(emp.name)}<br><small style="color:var(--ts);font-weight:400;">${escapeHtml(emp.designation || 'Employee')}</small></td>
        <td class="rpt-td-avg">${empAvg}</td>
        <td class="rpt-td-num">${empTotal}</td>
        ${cells}</tr>`;
    }).join('');

    const footCells = d.days.map((day) => d.isWeekend[day] ? '<td class="rpt-td-we"></td>' : `<td>${dayTotals[day] || ''}</td>`).join('');
    const head = rptHead(d, [{ h: 'Average' }, { h: 'TOTAL' }], 'Daily Visit Report — ' + (d.periodLabel || d.monthLabel + ' ' + d.year));

    el.dvrGrid.innerHTML = `<table class="rpt-tbl">${head}<tbody>${bodyRows}</tbody>
      <tfoot><tr>
        <td class="rpt-sticky-sn"></td>
        <td class="rpt-sticky-name rpt-td-name" style="font-weight:800;color:#1a3a6b;">TOTAL</td>
        <td class="rpt-td-avg">${avgSum.toFixed(2)}</td>
        <td class="rpt-td-num">${grandTotal}</td>
        ${footCells}</tr></tfoot></table>`;
  }

  function buildSq(d) {
    const emps = d.reportEmployees && d.reportEmployees.length ? d.reportEmployees : d.employees;
    const dayTotals = {}; d.days.forEach((x) => { dayTotals[x] = 0; });
    let totBF = 0, totNew = 0, totGrand = 0;

    const bodyRows = emps.map((emp, idx) => {
      const tot = d.empTotals[emp.crmId] || {};
      const bf = tot.sqBF || 0, newC = tot.sq || 0, grand = tot.sqGrandTotal || 0, avg = (tot.avgSq || 0).toFixed(1);
      totBF += bf; totNew += newC; totGrand += grand;
      const cells = d.days.map((day) => {
        const v = (d.sqGrid[emp.crmId] || {})[day] || 0;
        dayTotals[day] += v;
        return d.isWeekend[day] ? '<td class="rpt-td-we"></td>' : `<td>${v || ''}</td>`;
      }).join('');
      return `<tr>
        <td class="rpt-sticky-sn">${idx + 1}</td>
        <td class="rpt-sticky-name rpt-td-name">${escapeHtml(emp.name)}<br><small style="color:var(--ts);font-weight:400;">${escapeHtml(emp.designation || 'Employee')}</small></td>
        <td class="rpt-td-num">${bf}</td><td class="rpt-td-num">${newC}</td><td class="rpt-td-num">${grand}</td><td class="rpt-td-avg">${avg}</td>
        ${cells}</tr>`;
    }).join('');

    const footCells = d.days.map((day) => d.isWeekend[day] ? '<td class="rpt-td-we"></td>' : `<td>${dayTotals[day] || ''}</td>`).join('');
    const head = rptHead(d, [{ h: 'BF' }, { h: 'Total' }, { h: 'Grand Total' }, { h: 'AVG' }]);

    el.sqGrid.innerHTML = `<table class="rpt-tbl">${head}<tbody>${bodyRows}</tbody>
      <tfoot><tr>
        <td class="rpt-sticky-sn"></td>
        <td class="rpt-sticky-name rpt-td-name" style="font-weight:800;color:#1a3a6b;">TOTAL</td>
        <td>${totBF}</td><td>${totNew}</td><td>${totGrand}</td><td></td>
        ${footCells}</tr></tfoot></table>`;
  }

  function buildKpi(d) {
    const emps = d.reportEmployees && d.reportEmployees.length ? d.reportEmployees : d.employees;
    const rows = emps.map((emp) => {
      const tot = d.empTotals[emp.crmId] || {};
      const dvrA = tot.dvr || 0, sqA = tot.sq || 0, d2dA = tot.d2d || 0;
      return `<tr>
        <td class="rpt-kpi-td-name">${escapeHtml(emp.name)} <span style="color:var(--ts);font-size:11px;">/ ${escapeHtml(emp.designation || 'Employee')}</span></td>
        <td class="rpt-tgt">10</td><td class="${dvrA >= 10 ? 'rpt-ach-ok' : 'rpt-ach-low'}">${dvrA}</td>
        <td class="rpt-tgt">6</td><td class="${sqA >= 6 ? 'rpt-ach-ok' : 'rpt-ach-low'}">${sqA}</td>
        <td class="rpt-tgt">8,000</td><td class="${d2dA >= 8000 ? 'rpt-ach-ok' : 'rpt-ach-low'}">${d2dA.toLocaleString()}</td>
      </tr>`;
    }).join('');

    el.kpiGrid.innerHTML = `<table class="rpt-kpi-tbl">
      <thead>
        <tr><th style="text-align:left;min-width:200px;">KPI's</th><th colspan="2">DVR / Daily</th><th colspan="2" class="rpt-hd-sq">Sales Queue / Daily</th><th colspan="2" class="rpt-hd-d2d">D2D</th></tr>
        <tr><th style="text-align:left;"></th><th>Target</th><th>Achieved</th><th class="rpt-hd-sq">Target</th><th class="rpt-hd-sq">Achieved</th><th class="rpt-hd-d2d">Target</th><th class="rpt-hd-d2d">Achieved</th></tr>
      </thead><tbody>${rows}</tbody></table>`;
  }

  function buildSummary(d) {
    const emps = d.reportEmployees && d.reportEmployees.length ? d.reportEmployees : d.employees;
    const rows = emps.map((emp) => {
      const tot = d.empTotals[emp.crmId] || {};
      return `<tr>
        <td class="rpt-kpi-td-name">${escapeHtml(emp.name)} <span style="color:var(--ts);font-size:11px;">/ ${escapeHtml(emp.designation || 'Employee')}</span></td>
        <td>${(tot.d2d || 0).toLocaleString()}</td><td>${(tot.avgDvr || 0).toFixed(1)}</td><td>${(tot.avgSq || 0).toFixed(1)}</td>
      </tr>`;
    }).join('');

    el.sumGrid.innerHTML = `<table class="rpt-kpi-tbl">
      <thead><tr><th style="text-align:left;min-width:200px;">Name</th><th>D2D (Brochures)</th><th>Avg DVR</th><th>Avg Sales Queue</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  // ---- CSV export (same multi-section format as the original) ----
  function exportReport() {
    if (!state.lastData) { showToast('Load a report first, then export.'); return; }
    const d = state.lastData;
    const emps = d.reportEmployees && d.reportEmployees.length ? d.reportEmployees : d.employees;
    const type = el.type.value || 'All';
    const label = d.periodLabel || (d.monthLabel + ' ' + d.year);

    function makeCSV(title, headers, rows) {
      const lines = [title, headers.map((h) => `"${h}"`).join(',')];
      rows.forEach((r) => lines.push(r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')));
      return lines.join('\n');
    }

    const sections = [];

    if (type === 'All' || type === 'DVR') {
      const hdr = ['S/No', 'Name', ...d.days.map((i) => d.dayNames[i] + ' ' + d.dayLabels[i]), 'Average', 'Total'];
      const rows = emps.map((emp, idx) => {
        const tot = d.empTotals[emp.crmId] || {};
        const cells = d.days.map((i) => d.isWeekend[i] ? '' : ((d.dvrGrid[emp.crmId] || {})[i] || 0) || '');
        return [idx + 1, emp.name, ...cells, (tot.avgDvr || 0).toFixed(2), tot.dvr || 0];
      });
      sections.push(makeCSV('Daily Visit Report — ' + label, hdr, rows));
    }

    if (type === 'All' || type === 'SQ') {
      const hdr = ['S/No', 'Name', 'BF', 'Total', 'Grand Total', 'AVG', ...d.days.map((i) => d.dayNames[i] + ' ' + d.dayLabels[i])];
      const rows = emps.map((emp, idx) => {
        const tot = d.empTotals[emp.crmId] || {};
        const cells = d.days.map((i) => d.isWeekend[i] ? '' : ((d.sqGrid[emp.crmId] || {})[i] || 0) || '');
        return [idx + 1, emp.name, tot.sqBF || 0, tot.sq || 0, tot.sqGrandTotal || 0, (tot.avgSq || 0).toFixed(1), ...cells];
      });
      sections.push(makeCSV('Sales Queue — ' + label, hdr, rows));
    }

    if (type === 'All' || type === 'KPI') {
      const hdr = ['Name', 'DVR Target', 'DVR Achieved', 'SQ Target', 'SQ Achieved', 'D2D Target', 'D2D Achieved'];
      const rows = emps.map((emp) => {
        const tot = d.empTotals[emp.crmId] || {};
        return [emp.name, 10, tot.dvr || 0, 6, tot.sq || 0, 8000, tot.d2d || 0];
      });
      sections.push(makeCSV('KPI Summary — ' + label, hdr, rows));
    }

    if (type === 'All' || type === 'Summary' || type === 'D2D') {
      const hdr = ['Name', 'D2D', 'Avg DVR', 'AVG Sales Queue'];
      const rows = emps.map((emp) => {
        const tot = d.empTotals[emp.crmId] || {};
        return [emp.name, tot.d2d || 0, (tot.avgDvr || 0).toFixed(1), (tot.avgSq || 0).toFixed(1)];
      });
      sections.push(makeCSV('Monthly Summary — ' + label, hdr, rows));
    }

    if (!sections.length) { showToast('No data to export.'); return; }

    const csv = sections.join('\n\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'report_' + label.replace(/[^a-z0-9]+/gi, '_') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    refresh: loadReport,
    unmount() { state.destroyed = true; root.innerHTML = ''; }
  };
}

// ============================================================================
// Static shell markup
// ============================================================================
function shellHtml() {
  return `
    <div class="am2-hdr" style="margin-top:14px;">
      <div class="am2-hdr-left">
        <div class="am2-title">Reports</div>
        <div class="am2-sub">City &amp; employee performance reports</div>
      </div>
    </div>

    <div id="rptStaleBanner" class="stale-banner" style="display:none;">
      <span class="material-icons">cloud_off</span> Showing last-known data — reconnect to refresh.
    </div>

    <div class="rpt-filter-bar">
      <div class="rpt-fi"><label>City</label><select id="rptCity"><option value="All">All Cities</option></select></div>
      <div class="rpt-fi"><label>Month</label>
        <select id="rptMonth">
          <option value="1">January</option><option value="2">February</option><option value="3">March</option>
          <option value="4">April</option><option value="5">May</option><option value="6">June</option>
          <option value="7">July</option><option value="8">August</option><option value="9">September</option>
          <option value="10">October</option><option value="11">November</option><option value="12">December</option>
        </select></div>
      <div class="rpt-fi"><label>Year</label>
        <select id="rptYear"><option value="2025">2025</option><option value="2026" selected>2026</option><option value="2027">2027</option></select></div>
      <div class="rpt-fi"><label>Employee</label><select id="rptEmp"><option value="All">All Employees</option></select></div>
      <div class="rpt-fi"><label>Report</label>
        <select id="rptType">
          <option value="All">All Reports</option><option value="DVR">DVR Report</option><option value="SQ">Sales Queue</option>
          <option value="D2D">D2D Summary</option><option value="KPI">KPI Summary</option><option value="Summary">Monthly Summary</option>
        </select></div>
      <div class="rpt-fi" style="align-self:flex-end;display:flex;gap:8px;">
        <button class="rpt-load-btn" id="rptLoadBtn"><span class="material-icons">refresh</span>Load Report</button>
        <button class="rpt-load-btn" id="rptExportBtn" style="background:#1a7a42;"><span class="material-icons">download</span>Export Report</button>
      </div>
    </div>

    <div id="rptSpinner" style="display:none;"></div>

    <div id="rptCards" style="display:none;">
      <div id="rptCardDvr" class="rpt-card">
        <div class="rpt-card-hd" style="background:#1a3a6b;"><span class="material-icons">directions_walk</span><span id="rptDvrTitle">Daily Visit Report</span></div>
        <div class="rpt-grid-wrap"><div id="rptDvrGrid" style="padding:0;"></div></div>
      </div>
      <div id="rptCardSq" class="rpt-card">
        <div class="rpt-card-hd" style="background:#0f6e56;"><span class="material-icons">people</span><span id="rptSqTitle">Sales Queue Report</span></div>
        <div class="rpt-grid-wrap"><div id="rptSqGrid" style="padding:0;"></div></div>
      </div>
      <div id="rptCardKpi" class="rpt-card">
        <div class="rpt-card-hd" style="background:#9a6a10;"><span class="material-icons">bar_chart</span><span id="rptKpiTitle">KPI Summary</span></div>
        <div style="padding:14px 16px;overflow-x:auto;"><div id="rptKpiGrid"></div></div>
      </div>
      <div id="rptCardSum" class="rpt-card" style="margin-bottom:12px;">
        <div class="rpt-card-hd" style="background:#5d4037;"><span class="material-icons">summarize</span><span id="rptSumTitle">Monthly Summary</span></div>
        <div style="padding:14px 16px;overflow-x:auto;"><div id="rptSumGrid"></div></div>
      </div>
    </div>
  `;
}
