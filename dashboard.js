// ============================================================================
// pages/dashboard.js
// Executive Dashboard — ported from the original inline exec* functions in
// Index.html. Same data, same layout, same CSV exports; now a mountable
// module instead of globals wired to a single fixed set of DOM ids.
//
// Usage:
//   import { mountDashboardPage } from './pages/dashboard.js';
//   const dash = mountDashboardPage(document.getElementById('viewDashboard'), { crmId, empName });
//   ...
//   dash.unmount();      // on navigating away, cleans up charts/listeners/timers
// ============================================================================
import { api } from '../services/api.js';
import { renderChart, destroyAllCharts, resizeChart, formatCompactNumber, pctColor, trendArrowHtml, SOI_COLORS, AVATAR_COLORS, MEDALS } from '../components/charts.js';
import { renderKpiSkeleton, renderCardSkeleton, renderListSkeleton } from '../components/loader.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/helpers.js';

const CACHE_TTL_MS = 60000; // matches the original client-side 60s freshness window

export function mountDashboardPage(root, { crmId, empName } = {}) {
  root.innerHTML = shellHtml();

  const q = (sel) => root.querySelector(sel);
  const state = {
    data: null,
    allPerformers: [],
    cache: new Map(), // paramsKey -> { data, time }
    busy: false,
    debounceTimer: null,
    destroyed: false
  };

  // ---- element refs ----
  const el = {
    lastUpdated: q('#exLastUpdated'),
    avatar: q('#exAvatar'),
    month: q('#exMonth'), from: q('#exFrom'), to: q('#exTo'),
    dateRange: q('#exDateRange'), city: q('#exCity'), emp: q('#exEmp'),
    loading: q('#exLoading'), content: q('#exContent'), staleBanner: q('#exStaleBanner'),
  };

  el.avatar.textContent = (empName || crmId || '?')[0].toUpperCase();

  // ---- wiring ----
  el.month.addEventListener('change', debounceFetch);
  el.from.addEventListener('change', debounceFetch);
  el.to.addEventListener('change', debounceFetch);
  el.city.addEventListener('change', onCityChange);
  el.emp.addEventListener('change', debounceFetch);
  el.dateRange.addEventListener('change', (e) => applyDateRangePreset(e.target.value));
  q('#exRefreshBtn').addEventListener('click', () => fetchAndRender(true));

  function debounceFetch() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => fetchAndRender(false), 400);
  }

  function applyDateRangePreset(preset) {
    const fmt = (d) => d.toISOString().slice(0, 10);
    const now = new Date();
    let from = '', to = '';
    if (preset === 'today') { from = to = fmt(now); }
    else if (preset === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); from = to = fmt(y); }
    else if (preset === 'last7') { const s = new Date(now); s.setDate(s.getDate() - 6); from = fmt(s); to = fmt(now); }
    else if (preset === 'last30') { const s = new Date(now); s.setDate(s.getDate() - 29); from = fmt(s); to = fmt(now); }
    else if (preset === 'thismonth') { from = fmt(now).slice(0, 7) + '-01'; to = fmt(now); }
    else if (preset === 'prevmonth') {
      const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pme = new Date(now.getFullYear(), now.getMonth(), 0);
      from = fmt(pm); to = fmt(pme);
    }
    el.from.value = from; el.to.value = to;
    if (preset) fetchAndRender(false);
  }

  function onCityChange() {
    const city = el.city.value;
    const prev = el.emp.value;
    while (el.emp.options.length > 1) el.emp.remove(1);
    (state.allPerformers || [])
      .filter((p) => city === 'All' || p.city === city)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((p) => {
        const o = document.createElement('option');
        o.value = p.crmId; o.textContent = p.name;
        el.emp.appendChild(o);
      });
    el.emp.value = prev;
    debounceFetch();
  }

  // ---- fetch ----
  async function fetchAndRender(force) {
    if (state.busy) return;
    state.busy = true;

    const params = {
      month: el.month.value,
      fromDate: el.from.value,
      toDate: el.to.value,
      city: el.city.value,
      employeeCrmId: el.emp.value
    };
    const cacheKey = JSON.stringify(params);
    const cached = state.cache.get(cacheKey);

    if (!force && cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
      renderAll(cached.data);
      state.busy = false;
      return;
    }

    el.loading.innerHTML = renderKpiSkeleton(3) + renderCardSkeleton(240);
    el.loading.style.display = 'block';
    el.content.style.display = 'none';

    try {
      const d = await api.getExecutiveDashboard(crmId, params);
      el.loading.style.display = 'none';
      if (!d || d.error) {
        showToast(d?.error || 'Dashboard error', { type: 'error' });
        state.busy = false;
        return;
      }
      state.cache.set(cacheKey, { data: d, time: Date.now() });
      renderAll(d);
    } catch (err) {
      el.loading.style.display = 'none';
      showToast('Dashboard error: ' + (err.message || err), { type: 'error' });
    }
    state.busy = false;
  }

  // ---- render orchestration ----
  function renderAll(d) {
    if (state.destroyed) return;
    state.data = d;
    state.allPerformers = d.allPerformers || [];

    el.staleBanner.style.display = d._stale ? 'flex' : 'none';
    el.lastUpdated.textContent = d._stale
      ? 'Showing last-known data (offline)'
      : 'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

    populateSelect(el.city, d.cities, false);
    populateSelect(el.emp, d.employees, true);
    ['#topCityF', '#lowCityF', '#alertCityF', '#soiCityF'].forEach((sel) => populateSelect(q(sel), d.cities, false));
    ['#alertEmpF', '#soiEmpF'].forEach((sel) => populateSelect(q(sel), d.employees, true));
    populateSelect(q('#matureEmpF'), d.employees, true);

    // Reveal the content area before rendering individual sections — if one
    // section throws (a bug, or an unexpected data shape), the sections
    // that already rendered stay visible instead of the whole dashboard
    // going blank behind a hidden #exContent.
    el.content.style.display = 'block';

    runSection(() => renderKpi(d));
    runSection(() => renderMonthly(d));
    runSection(() => renderMature(d));
    runSection(() => renderCityTarget(d));
    runSection(() => renderSoi(d));
    runSection(() => filterPerformers());
    runSection(() => renderAlerts(d));
  }

  function runSection(fn) {
    try {
      const result = fn();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => console.error('[dashboard] section render failed:', err));
      }
    } catch (err) {
      console.error('[dashboard] section render failed:', err);
    }
  }

  function populateSelect(selectEl, list, isEmp) {
    if (!selectEl) return;
    const prev = selectEl.value;
    while (selectEl.options.length > 1) selectEl.remove(1);
    (list || []).forEach((x) => {
      const o = document.createElement('option');
      o.value = isEmp ? x.crmId : x;
      o.textContent = isEmp ? `${x.name} (${x.city})` : x;
      selectEl.appendChild(o);
    });
    selectEl.value = prev;
  }

  // ---- KPI cards ----
  function renderKpi(d) {
    const kpi = d.kpi;
    setKpi('dvr', kpi.daily.dvr);
    setKpi('sq', kpi.daily.sq);
    setKpi('d2d', kpi.daily.d2d);
  }
  function setKpi(key, data) {
    q(`#xk${cap(key)}V`).textContent = formatCompactNumber(data.actual);
    q(`#xk${cap(key)}T`).textContent = formatCompactNumber(data.target);
    setTimeout(() => { q(`#xk${cap(key)}B`).style.width = Math.min(100, data.pct) + '%'; }, 150);
    const pctEl = q(`#xk${cap(key)}P`);
    pctEl.textContent = data.pct + '%';
    pctEl.style.color = pctColor(data.pct);
    q(`#xk${cap(key)}Trend`).innerHTML = trendArrowHtml(data.pct);
  }
  function cap(k) { return k === 'dvr' ? 'Dvr' : k === 'sq' ? 'Sq' : 'D2d'; }

  // Toggles a "no data" message next to a chart's <canvas> WITHOUT removing
  // the canvas from the DOM. Earlier code replaced canvas.parentElement's
  // entire innerHTML on empty data, which deleted the canvas permanently —
  // any later render (e.g. picking a different employee/date range) then
  // crashed looking for a canvas that no longer existed, blanking the whole
  // dashboard. This keeps the canvas alive and just hides/shows it.
  function setChartNoData(canvas, show, icon, msg) {
    const parent = canvas.parentElement;
    let overlay = parent.querySelector('.chart-nodata-overlay');
    if (show) {
      canvas.style.display = 'none';
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'chart-nodata-overlay';
        parent.appendChild(overlay);
      }
      overlay.innerHTML = noData(icon, msg);
    } else {
      canvas.style.display = '';
      overlay?.remove();
    }
  }

  // ---- Monthly trend chart ----
  async function renderMonthly(d) {
    const canvas = q('#xcMonthlyChart');
    if (!d.monthlyTrend || !d.monthlyTrend.length) {
      setChartNoData(canvas, true, 'insert_chart', 'No trend data for selected filters.');
      return;
    }
    setChartNoData(canvas, false);
    await renderChart('monthly', canvas, {
      type: 'bar',
      data: {
        labels: d.monthlyTrend.map((t) => t.label),
        datasets: [
          { label: 'DVR (Visits)', data: d.monthlyTrend.map((t) => t.dvr), backgroundColor: 'rgba(29,78,216,.82)', borderRadius: 5, barPercentage: .65 },
          { label: 'Sales Queue', data: d.monthlyTrend.map((t) => t.sq), backgroundColor: 'rgba(21,128,61,.82)', borderRadius: 5, barPercentage: .65 },
          { label: 'D2D', data: d.monthlyTrend.map((t) => t.d2d), backgroundColor: 'rgba(161,98,7,.82)', borderRadius: 5, barPercentage: .65 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 11 }, usePointStyle: true } }, tooltip: { mode: 'index', intersect: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f0f4fb' }, beginAtZero: true } }
      }
    });
  }

  // ---- City mature comparison ----
  async function renderMature(d) {
    const canvas = q('#xcMatureChart');
    const empF = q('#matureEmpF')?.value;
    let cd;
    if (empF && d.maturedEmpCity && d.maturedEmpCity[empF]) {
      const m = d.maturedEmpCity[empF];
      cd = Object.keys(m).sort((a, b) => m[b] - m[a]).map((c) => ({ city: c, count: m[c] }));
    } else {
      cd = (d.cityMatured || []).slice().sort((a, b) => b.count - a.count);
    }
    if (!cd || !cd.length) {
      setChartNoData(canvas, true, 'location_city', 'No mature data.');
      return;
    }
    setChartNoData(canvas, false);
    await renderChart('mature', canvas, {
      type: 'bar',
      data: {
        labels: cd.map((c) => c.city),
        datasets: [{
          label: 'Matured Signups', data: cd.map((c) => c.count),
          backgroundColor: (ctx) => {
            const v = cd[ctx.dataIndex]?.count || 0;
            const mx = cd[0]?.count || 1;
            const pct = v / mx;
            return pct >= .85 ? 'rgba(21,128,61,.85)' : pct >= .5 ? 'rgba(29,78,216,.85)' : 'rgba(220,38,38,.8)';
          },
          borderRadius: 5, barThickness: 20
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + c.raw + ' Matured' } } },
        scales: { x: { grid: { color: '#f0f4fb' }, beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }
      }
    });
  }
  q('#matureEmpF').addEventListener('change', () => state.data && renderMature(state.data));

  // ---- City target achievement (progress bars, not a chart) ----
  function renderCityTarget(d) {
    const container = q('#xcCityTBody');
    const cd = d.cityData;
    if (!cd || !cd.length) { container.innerHTML = noData('flag', 'No city data.'); return; }
    container.innerHTML = cd.map((c) => {
      const avg = Math.round((c.dvrPct + c.sqPct + c.d2dPct) / 3);
      return `<div class="ex-ct-item">
        <div class="ex-ct-name"><span>${escapeHtml(c.city)}</span><span style="color:${pctColor(avg)};font-weight:800;">${avg}%</span></div>
        <div class="ex-ct-bar-wrap"><div class="ex-ct-bar" data-w="${avg}" style="background:${pctColor(avg)};"></div></div>
        <div class="ex-ct-meta">DVR ${c.dvrPct}% &nbsp;|&nbsp; SQ ${c.sqPct}% &nbsp;|&nbsp; D2D ${c.d2dPct}%</div>
      </div>`;
    }).join('<hr style="border:none;border-top:1px solid var(--br);margin:2px 0;">');
    setTimeout(() => container.querySelectorAll('.ex-ct-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; }), 120);
  }

  // ---- SOI donut ----
  async function renderSoi(d) {
    const canvas = q('#xcSoiChart');
    const legend = q('#xcSoiLegend');
    const soi = d.soiDistribution || [];
    if (!soi.length) {
      setChartNoData(canvas, true, 'donut_large', 'No SOI data.');
      legend.innerHTML = '';
      return;
    }
    setChartNoData(canvas, false);
    await renderChart('soi', canvas, {
      type: 'doughnut',
      data: { labels: soi.map((s) => s.soi), datasets: [{ data: soi.map((s) => s.count), backgroundColor: SOI_COLORS, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw} (${Math.round(c.raw / c.dataset.data.reduce((a, b) => a + b, 0) * 100)}%)` } } }
      }
    });
    legend.innerHTML = soi.map((s, i) => `
      <div style="display:flex;align-items:center;gap:5px;">
        <div style="width:10px;height:10px;border-radius:2px;background:${SOI_COLORS[i % SOI_COLORS.length]};flex-shrink:0;"></div>
        <span style="flex:1;font-size:11px;color:var(--tm);">${escapeHtml(s.soi)}</span>
        <b style="font-size:11px;">${s.pct}%</b>
      </div>`).join('');
  }
  ['#soiCityF', '#soiEmpF'].forEach((sel) => q(sel).addEventListener('change', () => state.data && renderSoi(state.data)));

  // ---- Performers (top / low) ----
  function filterPerformers() {
    const tCity = q('#topCityF')?.value;
    const lCity = q('#lowCityF')?.value;
    let top = state.allPerformers.filter((p) => !tCity || p.city === tCity);
    let low = state.allPerformers.filter((p) => !lCity || p.city === lCity);
    top = top.slice().sort((a, b) => b.overallPct - a.overallPct).slice(0, 3);
    low = low.slice().sort((a, b) => a.overallPct - b.overallPct).slice(0, 3);
    renderPerformerList(top, q('#xcTopBody'), true);
    renderPerformerList(low, q('#xcLowBody'), false);
  }
  ['#topCityF', '#lowCityF'].forEach((sel) => q(sel).addEventListener('change', filterPerformers));

  function renderPerformerList(list, container, isTop) {
    if (!list || !list.length) {
      container.innerHTML = noData(isTop ? 'emoji_events' : 'trending_down', 'No performers for selected filter.');
      return;
    }
    container.innerHTML = '<div class="ex-perf-list">' + list.map((p, i) => {
      const initials = (p.name || '?').trim().split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase();
      const aColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
      const barClr = pctColor(p.overallPct);
      return `<div class="ex-perf">
        <div class="ex-perf-avatar" style="background:${aColor};">${initials}<span class="ex-perf-badge">${MEDALS[i] || ''}</span></div>
        <div class="ex-perf-info">
          <div class="ex-perf-name">${escapeHtml(p.name)}</div>
          <div class="ex-perf-city">${escapeHtml(p.city)} · ${escapeHtml(p.designation || p.role || 'Employee')}</div>
          <div class="ex-perf-stats"><span>DVR <b>${p.dvr}</b></span><span>SQ <b>${p.sq}</b></span><span>D2D <b>${p.d2d}</b></span></div>
          <div class="ex-perf-bar"><div class="ex-perf-barfill" style="width:${p.overallPct}%;background:${barClr};"></div></div>
        </div>
        <div class="ex-perf-pct" style="color:${barClr};">${p.overallPct}%</div>
      </div>`;
    }).join('') + '</div>';
  }

  // ---- Alerts ----
  function renderAlerts(d) {
    const container = q('#xcAlertsBody');
    const cF = q('#alertCityF')?.value;
    const eF = q('#alertEmpF')?.value;
    const perf = state.allPerformers.filter((p) => (!cF || p.city === cF) && (!eF || p.crmId === eF));
    if (!perf.length) { container.innerHTML = noData('people', 'No employee data for selected filter.'); return; }
    container.innerHTML = '<div class="ex-alerts-grid">' + perf.map((p) => {
      const cls = p.overallPct >= 85 ? 'al-green' : p.overallPct >= 70 ? 'al-orange' : 'al-red';
      const ico = p.overallPct >= 85 ? 'check_circle' : p.overallPct >= 70 ? 'warning' : 'error';
      const remDvr = Math.max(0, p.dvrTarget - p.dvr);
      const remSq = Math.max(0, p.sqTarget - p.sq);
      const remD2d = Math.max(0, p.d2dTarget - p.d2d);
      return `<div class="ex-al ${cls}">
        <span class="material-icons">${ico}</span>
        <div>
          <div class="ex-al-name">${escapeHtml(p.name)}</div>
          <div class="ex-al-city">${escapeHtml(p.city)}</div>
          <div class="ex-al-pct" style="color:${pctColor(p.overallPct)};">${p.overallPct}% Overall Achievement</div>
          ${p.overallPct < 100 ? `<div class="ex-al-rem">Remaining — DVR: ${remDvr} · SQ: ${remSq} · D2D: ${remD2d}</div>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>';
  }
  ['#alertCityF', '#alertEmpF'].forEach((sel) => q(sel).addEventListener('change', () => state.data && renderAlerts(state.data)));

  // ---- Fullscreen toggle ----
  root.querySelectorAll('[data-fs-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = q('#' + btn.dataset.fsTarget);
      if (!target) return;
      target.classList.toggle('ex-fs-open');
      target.querySelectorAll('canvas').forEach((c) => resizeChart(c.dataset.chartKey));
    });
  });

  // ---- CSV export ----
  root.querySelectorAll('[data-export]').forEach((btn) => btn.addEventListener('click', () => exportCsv(btn.dataset.export)));
  root.querySelectorAll('[data-export-kpi]').forEach((btn) => btn.addEventListener('click', () => exportKpi(btn.dataset.exportKpi)));

  function exportKpi(type) {
    if (!state.data?.kpi) return;
    const k = state.data.kpi.daily;
    const map = { dvr: ['Total Visits (DVR)', k.dvr], sq: ['Sales Queue', k.sq], d2d: ['Door-to-Door', k.d2d] };
    const d = map[type];
    if (!d) return;
    downloadCsv(`kpi_${type}_today.csv`, 'Metric,Period,Actual,Target,Achievement %\n' + `${d[0]},Today,${d[1].actual},${d[1].target},${d[1].pct}%`);
  }

  function exportCsv(type) {
    const d = state.data;
    if (!d) return;
    let csv, fn;
    if (type === 'monthly' && d.monthlyTrend) {
      csv = 'Month,DVR,Sales Queue,D2D\n' + d.monthlyTrend.map((t) => [t.label, t.dvr, t.sq, t.d2d].join(',')).join('\n');
      fn = 'monthly_trend.csv';
    } else if (type === 'mature' && d.cityMatured) {
      csv = 'City,Matured\n' + d.cityMatured.map((c) => escapeHtml(c.city) + ',' + c.count).join('\n');
      fn = 'city_mature.csv';
    } else if (type === 'cityTarget' && d.cityData) {
      csv = 'City,DVR%,SQ%,D2D%,Overall%\n' + d.cityData.map((c) => [escapeHtml(c.city), c.dvrPct, c.sqPct, c.d2dPct, Math.round((c.dvrPct + c.sqPct + c.d2dPct) / 3)].join(',')).join('\n');
      fn = 'city_target.csv';
    } else if (type === 'soi' && d.soiDistribution) {
      csv = 'SOI,Count,%\n' + d.soiDistribution.map((s) => `${escapeHtml(s.soi)},${s.count},${s.pct}%`).join('\n');
      fn = 'soi.csv';
    } else if (type === 'performers') {
      csv = 'Name,City,DVR,SQ,D2D,Overall%\n' + state.allPerformers.map((p) => [escapeHtml(p.name), escapeHtml(p.city), p.dvr, p.sq, p.d2d, p.overallPct + '%'].join(',')).join('\n');
      fn = 'performers.csv';
    } else if (type === 'alerts') {
      csv = 'Name,City,Overall%,Status\n' + state.allPerformers.map((p) => {
        const s = p.overallPct >= 85 ? 'Good' : p.overallPct >= 70 ? 'Warning' : 'Critical';
        return [escapeHtml(p.name), escapeHtml(p.city), p.overallPct + '%', s].join(',');
      }).join('\n');
      fn = 'alerts.csv';
    } else return;
    downloadCsv(fn, csv);
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function noData(icon, msg) {
    return `<div class="ex-nodata"><span class="material-icons">${icon}</span>${escapeHtml(msg)}</div>`;
  }

  // ---- initial load ----
  fetchAndRender(false);

  return {
    refresh: () => fetchAndRender(true),
    unmount() {
      state.destroyed = true;
      clearTimeout(state.debounceTimer);
      destroyAllCharts();
      root.innerHTML = '';
    }
  };
}

// ============================================================================
// Static shell markup — built once per mount, then only its contents mutate.
// ============================================================================
function shellHtml() {
  return `
    <div class="ex-hdr">
      <div class="ex-hdr-left">
        <div class="ex-hdr-title">Sales Performance Dashboard</div>
        <div class="ex-hdr-sub" id="exLastUpdated">Fetching data…</div>
      </div>
      <div class="ex-hdr-right">
        <button class="ex-icon-btn" id="exRefreshBtn" title="Refresh"><span class="material-icons">refresh</span></button>
        <div class="ex-avatar" id="exAvatar">?</div>
      </div>
    </div>

    <div id="exStaleBanner" class="stale-banner" style="display:none;">
      <span class="material-icons">cloud_off</span> Showing last-known data — reconnect to refresh.
    </div>

    <div class="ex-fbar">
      <div class="ex-fi"><label>Month</label>
        <select id="exMonth">
          <option value="All">All Months</option>
          <option value="01">January</option><option value="02">February</option>
          <option value="03">March</option><option value="04">April</option>
          <option value="05">May</option><option value="06">June</option>
          <option value="07">July</option><option value="08">August</option>
          <option value="09">September</option><option value="10">October</option>
          <option value="11">November</option><option value="12">December</option>
        </select></div>
      <div class="ex-fi"><label>Date Range</label>
        <select id="exDateRange">
          <option value="">Custom / All</option>
          <option value="today">Today</option><option value="yesterday">Yesterday</option>
          <option value="last7">Last 7 Days</option><option value="last30">Last 30 Days</option>
          <option value="thismonth">Current Month</option><option value="prevmonth">Previous Month</option>
        </select></div>
      <input type="date" id="exFrom" class="ex-date" title="From">
      <input type="date" id="exTo" class="ex-date" title="To">
      <div class="ex-fi"><label>City</label><select id="exCity"><option value="All">Nationwide</option></select></div>
      <div class="ex-fi"><label>Employee</label><select id="exEmp"><option value="All">All Employees</option></select></div>
    </div>

    <div id="exLoading" class="ex-loading"></div>

    <div id="exContent" style="display:none;">
      <div class="ex-kpi-row">
        ${kpiCardHtml('dvr', 'Total Visits', 'location_on', 'dvr-ico')}
        ${kpiCardHtml('sq', 'Sales Queue', 'people', 'sq-ico')}
        ${kpiCardHtml('d2d', 'Door-to-Door', 'directions_walk', 'd2d-ico')}
      </div>

      <div class="ex-row3">
        <div class="ex-card" id="xcMonthly">
          <div class="ex-card-hd">
            <span class="material-icons">bar_chart</span><span class="ex-card-ttl">Monthly Target vs Achievement</span>
            <div class="ex-card-acts">
              <button class="ex-ab" data-export="monthly" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcMonthly" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" style="padding:12px 16px 16px;"><div style="position:relative;height:240px;"><canvas id="xcMonthlyChart" data-chart-key="monthly"></canvas></div></div>
        </div>
        <div class="ex-card" id="xcMature">
          <div class="ex-card-hd">
            <span class="material-icons">location_city</span><span class="ex-card-ttl">City-wise Mature Comparison</span>
            <div class="ex-card-acts">
              <select id="matureEmpF" class="ex-sel-sm"><option value="">All Employees</option></select>
              <button class="ex-ab" data-export="mature" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcMature" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" style="padding:12px 16px 16px;"><div style="position:relative;height:240px;"><canvas id="xcMatureChart" data-chart-key="mature"></canvas></div></div>
        </div>
        <div class="ex-card" id="xcCityT">
          <div class="ex-card-hd">
            <span class="material-icons">flag</span><span class="ex-card-ttl">City-wise Target Achievement</span>
            <div class="ex-card-acts">
              <button class="ex-ab" data-export="cityTarget" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcCityT" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" id="xcCityTBody"></div>
        </div>
      </div>

      <div class="ex-row4">
        <div class="ex-card" id="xcSoi">
          <div class="ex-card-hd">
            <span class="material-icons">donut_large</span><span class="ex-card-ttl">SOI Analysis</span>
            <div class="ex-card-acts">
              <select id="soiCityF" class="ex-sel-sm"><option value="">All Cities</option></select>
              <select id="soiEmpF" class="ex-sel-sm"><option value="">All Employees</option></select>
              <button class="ex-ab" data-export="soi" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcSoi" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd"><div style="position:relative;height:200px;"><canvas id="xcSoiChart" data-chart-key="soi"></canvas></div><div id="xcSoiLegend" class="ex-soi-leg"></div></div>
        </div>
        <div class="ex-card" id="xcTop">
          <div class="ex-card-hd" style="background:linear-gradient(90deg,#fef9c3,transparent);">
            <span class="material-icons" style="color:#a16207;">emoji_events</span><span class="ex-card-ttl">Top Performers</span>
            <div class="ex-card-acts">
              <select id="topCityF" class="ex-sel-sm"><option value="">Nationwide</option></select>
              <button class="ex-ab" data-export="performers" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcTop" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" id="xcTopBody"></div>
        </div>
        <div class="ex-card" id="xcLow">
          <div class="ex-card-hd" style="background:linear-gradient(90deg,#fef2f2,transparent);">
            <span class="material-icons" style="color:#dc2626;">trending_down</span><span class="ex-card-ttl" style="color:#991b1b;">Low Performers</span>
            <div class="ex-card-acts">
              <select id="lowCityF" class="ex-sel-sm"><option value="">Nationwide</option></select>
              <button class="ex-ab" data-fs-target="xcLow" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" id="xcLowBody"></div>
        </div>
        <div class="ex-card" id="xcAlerts">
          <div class="ex-card-hd">
            <span class="material-icons">notifications_active</span><span class="ex-card-ttl">Performance Alerts</span>
            <div class="ex-card-acts">
              <select id="alertCityF" class="ex-sel-sm"><option value="">All Cities</option></select>
              <select id="alertEmpF" class="ex-sel-sm"><option value="">All Employees</option></select>
              <button class="ex-ab" data-export="alerts" title="Export"><span class="material-icons">download</span></button>
              <button class="ex-ab" data-fs-target="xcAlerts" title="Fullscreen"><span class="material-icons">fullscreen</span></button>
            </div>
          </div>
          <div class="ex-card-bd" id="xcAlertsBody"></div>
        </div>
      </div>
    </div>
  `;
}

function kpiCardHtml(key, label, icon, iconClass) {
  const Key = key === 'dvr' ? 'Dvr' : key === 'sq' ? 'Sq' : 'D2d';
  return `
    <div class="ex-kpi ex-kpi-${key}" id="xk${Key}">
      <div class="ex-kpi-head">
        <div class="ex-kpi-ico ${iconClass}"><span class="material-icons">${icon}</span></div>
        <div class="ex-kpi-label">${label}<span class="ex-kpi-badge">Today</span></div>
        <div class="ex-kpi-acts"><button class="ex-ab" data-export-kpi="${key}" title="Export"><span class="material-icons">download</span></button></div>
      </div>
      <div class="ex-kpi-trend" id="xk${Key}Trend"></div>
      <div class="ex-kpi-value" id="xk${Key}V">—</div>
      <div class="ex-kpi-sub">Target: <b id="xk${Key}T">—</b></div>
      <div class="ex-kpi-prog"><div class="ex-kpi-bar ${key}-bar" id="xk${Key}B"></div><span class="ex-kpi-pct" id="xk${Key}P">—%</span></div>
    </div>`;
}
