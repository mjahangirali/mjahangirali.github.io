// ============================================================================
// ApiBridge.gs
// ----------------------------------------------------------------------------
// Add this as a NEW file in the SAME Apps Script project as Code.gs
// (Project → + next to Files → Script). Do NOT paste this into Code.gs and
// do NOT rename or modify any function inside Code.gs — this file only
// exposes the existing functions over HTTP as JSON so the standalone NSMS
// PWA (hosted on GitHub Pages / Firebase / Netlify) can call them via fetch().
//
// Code.gs keeps serving the original HTML app at the /exec URL exactly as
// before (doGet is untouched) — nothing about the current deployment breaks.
//
// Redeploy required after adding this file:
//   Deploy → Manage deployments → Edit (pencil) → New version → Deploy
// ============================================================================

// Whitelist of Code.gs functions callable from the PWA. Anything not listed
// here is rejected even if the name matches a real function — this is the
// only access-control boundary between the public fetch() endpoint and your
// script, so keep it explicit rather than opening up all global functions.
var API_ALLOWED_FUNCTIONS = [
  'signIn', 'changePassword', 'adminResetPassword',
  'pingServer', 'getServerDateTime',
  'getProfile', 'getDashboardData',
  'getMyEntries', 'submitEntry', 'checkDuplicateContact',
  'applyEditDirect', 'submitEditRequest', 'deleteEntry',
  'getPendingApprovals', 'approveEditRequest', 'rejectEditRequest',
  'exportToGoogleSheet', 'bulkUploadEntries',
  'getExecutiveDashboard', 'getCityReport', 'getFilterLists'
];

// Functions that write data. The PWA uses this same list (mirrored in
// utils/constants.js) to decide what must go through the offline queue and
// idempotency guard below when the device has no connection.
var API_MUTATING_FUNCTIONS = [
  'submitEntry', 'submitEditRequest', 'applyEditDirect', 'deleteEntry',
  'approveEditRequest', 'rejectEditRequest', 'changePassword',
  'adminResetPassword', 'bulkUploadEntries'
];

// Single POST endpoint: body = { fn: 'getDashboardData', args: ['CRM123'], clientId: 'uuid' }
// clientId is optional and only meaningful for mutating calls (see below).
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ error: 'Empty request body.' });
    }

    var body = JSON.parse(e.postData.contents);
    var fn = String(body.fn || '');
    var args = Array.isArray(body.args) ? body.args : [];
    var clientId = body.clientId || null;

    if (API_ALLOWED_FUNCTIONS.indexOf(fn) === -1) {
      return jsonOut_({ error: 'Unknown or unauthorized function: ' + fn });
    }

    var isMutation = API_MUTATING_FUNCTIONS.indexOf(fn) !== -1;

    // The offline queue in the PWA retries a queued mutation until it gets a
    // response. If the first attempt actually succeeded server-side but the
    // client never received the response (dropped connection, backgrounded
    // tab, etc.), a naive retry would create a duplicate entry. clientId lets
    // us recognize "I already did this" and return the original result
    // instead of re-running the write.
    if (isMutation && clientId) {
      var cached = getIdempotentResult_(clientId);
      if (cached) return jsonOut_(cached);
    }

    var fn_ = this[fn];
    var result = fn_.apply(null, args);

    if (isMutation && clientId) {
      storeIdempotentResult_(clientId, result);
    }

    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: 'ApiBridge error: ' + err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Idempotency store (survives up to 6h, long enough to cover any
// realistic offline stretch before the queue would have already resolved) ----
function getIdempotentResult_(clientId) {
  try {
    var cached = CacheService.getScriptCache().get('idemp_' + clientId);
    return cached ? JSON.parse(cached) : null;
  } catch (e) { return null; }
}
function storeIdempotentResult_(clientId, result) {
  try {
    CacheService.getScriptCache().put('idemp_' + clientId, JSON.stringify(result), 21600);
  } catch (e) {}
}

// ----------------------------------------------------------------------------
// KNOWN EXISTING BUG (pre-dates this bridge, left untouched per "do not
// rewrite backend logic"): exportToGoogleSheet(crmId, startDate, endDate)
// in Code.gs calls getMyEntries(crmId, startDate, endDate), but
// getMyEntries(crmId, params) expects a single params object with
// .fromDate/.toDate — so startDate/endDate are silently ignored today and
// exportToGoogleSheet exports the caller's entire unfiltered scope. Flagging
// here rather than fixing silently; call it out to your team if the export
// range matters. Fix (only if you approve it) would be:
//   exportToGoogleSheet: replace
//     getMyEntries(crmId, startDate, endDate)
//   with
//     getMyEntries(crmId, { fromDate: startDate, toDate: endDate, pageSize: 100000 })
// ----------------------------------------------------------------------------
