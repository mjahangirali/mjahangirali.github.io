// ============================================================================
// components/charts.js
// Chart.js is loaded lazily (only on pages that actually render a chart) via
// its ESM build from jsDelivr, instead of the old global <script> tag in
// Index.html — keeps the base bundle smaller for pages that don't chart
// anything (wizard, profile).
// ============================================================================

let _chartClassPromise = null;

export function loadChartClass() {
  if (!_chartClassPromise) {
    _chartClassPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/+esm')
      .then((mod) => mod.Chart);
  }
  return _chartClassPromise;
}

// Registry so a page can destroy-and-recreate charts by key without leaking
// old Chart.js instances (each dashboard/report render call starts clean).
const registry = new Map();

export function destroyChart(key) {
  const existing = registry.get(key);
  if (existing) { existing.destroy(); registry.delete(key); }
}

export function destroyAllCharts() {
  registry.forEach((c) => c.destroy());
  registry.clear();
}

export async function renderChart(key, canvas, config) {
  const Chart = await loadChartClass();
  destroyChart(key);
  const instance = new Chart(canvas.getContext('2d'), config);
  registry.set(key, instance);
  return instance;
}

export function resizeChart(key) {
  const instance = registry.get(key);
  if (instance) instance.resize();
}

// ---------------------------------------------------------------------------
// Shared formatting helpers (ported from the original inline execFmt/exPctClr/exTrend)
// ---------------------------------------------------------------------------

export function formatCompactNumber(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export function pctColor(pct) {
  return pct >= 85 ? '#15803d' : pct >= 70 ? '#d97706' : '#dc2626';
}

export function trendArrowHtml(pct) {
  if (pct >= 80) return '<span style="color:#15803d;font-size:18px;" title="On track">↑</span>';
  if (pct >= 50) return '<span style="color:#d97706;font-size:18px;" title="At risk">→</span>';
  return '<span style="color:#dc2626;font-size:18px;" title="Behind">↓</span>';
}

export const SOI_COLORS = ['#1d4ed8', '#15803d', '#a16207', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#0f766e'];
export const AVATAR_COLORS = ['#1d4ed8', '#15803d', '#a16207', '#7c3aed', '#0891b2'];
export const MEDALS = ['🥇', '🥈', '🥉'];
