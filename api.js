// ============================================================================
// services/api.js
// Public API surface for the whole app. Every export here maps 1:1 to a
// real function in Code.gs (via backend/ApiBridge.gs) — same name, same
// argument order. Pages should only ever import `api` from this file, never
// call transport.js/sync.js directly.
// ============================================================================
import { rawCall, ApiError } from './transport.js';
import { queueMutation } from './sync.js';
import { getCachedResponse, setCachedResponse, isCacheable } from './cache.js';
import { MUTATING_FUNCTIONS } from '../utils/constants.js';
import { uuid } from '../utils/helpers.js';

async function call(fn, ...args) {
  const isMutation = MUTATING_FUNCTIONS.includes(fn);

  if (isMutation) {
    if (!navigator.onLine) {
      return queueMutation(fn, args);
    }
    const clientId = uuid();
    try {
      return await rawCall(fn, args, clientId);
    } catch (err) {
      // Network-level failure while "online" (flaky connection, DNS hiccup,
      // server unreachable) → don't lose the write, queue it for retry.
      // A server-returned validation/permission error is NOT retried — it's
      // surfaced to the caller so the UI can show it immediately.
      if (err instanceof ApiError && err.isNetworkError) {
        return queueMutation(fn, args);
      }
      throw err;
    }
  }

  // Reads: network-first, cache fallback when offline or the request fails.
  try {
    const data = await rawCall(fn, args);
    if (isCacheable(fn)) setCachedResponse(fn, args, data);
    return data;
  } catch (err) {
    const cached = await getCachedResponse(fn, args);
    if (cached) return { ...cached, _stale: true, _staleReason: err.message };
    throw err;
  }
}

export const api = {
  // ---- Auth ----
  signIn: (identifier, password) => call('signIn', identifier, password),
  changePassword: (crmId, currentPwd, newPwd) => call('changePassword', crmId, currentPwd, newPwd),
  adminResetPassword: (adminCrmId, targetCrmId, tempPassword) =>
    call('adminResetPassword', adminCrmId, targetCrmId, tempPassword),

  // ---- System ----
  pingServer: () => call('pingServer'),
  getServerDateTime: () => call('getServerDateTime'),

  // ---- Profile ----
  getProfile: (crmId) => call('getProfile', crmId),

  // ---- Dashboard ----
  getDashboardData: (crmId) => call('getDashboardData', crmId),
  getExecutiveDashboard: (crmId, params) => call('getExecutiveDashboard', crmId, params),
  getCityReport: (crmId, params) => call('getCityReport', crmId, params),
  getFilterLists: (crmId) => call('getFilterLists', crmId),

  // ---- Entries ----
  getMyEntries: (crmId, params) => call('getMyEntries', crmId, params),
  submitEntry: (record) => call('submitEntry', record),
  checkDuplicateContact: (contact) => call('checkDuplicateContact', contact),
  deleteEntry: (crmId, rowIndex) => call('deleteEntry', crmId, rowIndex),

  // ---- Edits / approvals ----
  applyEditDirect: (crmId, rowIndex, changes) => call('applyEditDirect', crmId, rowIndex, changes),
  submitEditRequest: (crmId, rowIndex, changes, originalData) =>
    call('submitEditRequest', crmId, rowIndex, changes, originalData),
  getPendingApprovals: (crmId) => call('getPendingApprovals', crmId),
  approveEditRequest: (crmId, requestId) => call('approveEditRequest', crmId, requestId),
  rejectEditRequest: (crmId, requestId, note) => call('rejectEditRequest', crmId, requestId, note),

  // ---- Export / bulk ----
  // NOTE: exportToGoogleSheet has a pre-existing server-side signature
  // mismatch (see backend/ApiBridge.gs bottom comment) — startDate/endDate
  // are currently ignored server-side. Left as-is per "don't rewrite
  // backend logic"; flagging here so it isn't mistaken for a frontend bug.
  exportToGoogleSheet: (crmId, startDate, endDate) => call('exportToGoogleSheet', crmId, startDate, endDate),
  bulkUploadEntries: (crmId, rows) => call('bulkUploadEntries', crmId, rows)
};
