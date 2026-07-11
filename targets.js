// ============================================================================
// pages/targets.js
// Static reference content — ported 1:1 from the original #viewTargets tab.
// No API calls; the numbers here are the same fixed constants used
// server-side (Code.gs's DVR_TARGET/SQ_TARGET/etc.) for the reader's context.
// ============================================================================

export function mountTargetsPage(root) {
  root.innerHTML = shellHtml();
  return { unmount() { root.innerHTML = ''; } };
}

function shellHtml() {
  return `
    <div class="am2-hdr" style="margin-top:14px;">
      <div class="am2-hdr-left"><div class="am2-title">Targets</div><div class="am2-sub">Performance targets for field teams</div></div>
    </div>

    <div class="dash-card" style="margin-top:14px;">
      <h3>Daily Targets</h3>
      ${targetRow('DVR (Physical Visits)', '10', 'per day', 'var(--nb)')}
      ${targetRow('Sales Queue (Unique)', '6', 'per day', '#0f6e56')}
      ${targetRow('D2D (Door-to-Door)', '300', 'per day', '#9a6a10')}
    </div>

    <div class="dash-card">
      <h3>Weekly Targets</h3>
      <div class="hint" style="margin:0 0 10px;">Based on 5 working days per week</div>
      ${targetRow('DVR (Physical Visits)', '50', 'per week', 'var(--nb)')}
      ${targetRow('Sales Queue (Unique)', '30', 'per week', '#0f6e56')}
      ${targetRow('D2D (Door-to-Door)', '2,000', 'per week', '#9a6a10')}
    </div>

    <div class="dash-card">
      <h3>Monthly Targets</h3>
      ${targetRow('DVR (Physical Visits)', '240', 'per month', 'var(--nb)')}
      ${targetRow('Sales Queue (Unique)', '132', 'per month', '#0f6e56')}
      ${targetRow('D2D (Door-to-Door)', '8,000', 'per month', '#9a6a10')}
    </div>

    <div class="dash-card">
      <h3>Designation-Wise Signup Targets</h3>
      <p class="hint" style="margin-top:0;margin-bottom:12px;">Monthly signup targets by job designation.</p>
      <table class="targets-tbl">
        <thead><tr><th>Designation</th><th style="text-align:right;">Monthly Target</th></tr></thead>
        <tbody>
          <tr><td>Assistant Account Manager</td><td class="targets-tbl-val">45</td></tr>
          <tr><td>Account Manager</td><td class="targets-tbl-val">55</td></tr>
          <tr><td>Senior Account Manager</td><td class="targets-tbl-val">66</td></tr>
          <tr><td>Corporate Account Manager</td><td class="targets-tbl-val">77</td></tr>
        </tbody>
      </table>
    </div>

    <div class="info-note" style="margin-top:14px;">
      Achievements against these targets are shown on your <b>Dashboard</b> tab with daily progress and KPI details.
    </div>
  `;
}

function targetRow(label, value, unit, color) {
  return `
    <div class="prof-row">
      <span class="prof-lbl">${label}</span>
      <span style="font-size:17px;font-weight:700;color:${color};">${value} <small style="font-size:12px;font-weight:400;color:var(--ts);">${unit}</small></span>
    </div>`;
}
