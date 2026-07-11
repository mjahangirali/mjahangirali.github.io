// ============================================================================
// utils/constants.js
// Single source of truth for config values used across services/pages.
// ============================================================================

// Replace with your deployed Apps Script Web App URL (Deploy → Manage
// deployments → Web app → URL). Must end in /exec, not /dev.
export const API_BASE_URL = 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec';

// Mirrors API_MUTATING_FUNCTIONS in backend/ApiBridge.gs. Keep both lists in
// sync — this one drives the offline queue, that one drives server auth.
export const MUTATING_FUNCTIONS = [
  'submitEntry',
  'submitEditRequest',
  'applyEditDirect',
  'deleteEntry',
  'approveEditRequest',
  'rejectEditRequest',
  'changePassword',
  'adminResetPassword',
  'bulkUploadEntries'
];

export const READ_FUNCTIONS = [
  'pingServer',
  'getServerDateTime',
  'getProfile',
  'getDashboardData',
  'getMyEntries',
  'checkDuplicateContact',
  'getPendingApprovals',
  'exportToGoogleSheet',
  'getExecutiveDashboard',
  'getCityReport',
  'getFilterLists'
];

// Reads worth persisting to IndexedDB for offline viewing. Keep this list
// deliberately smaller than READ_FUNCTIONS — caching every read wastes
// storage on things like exportToGoogleSheet that are meaningless offline.
export const CACHEABLE_READS = [
  'getDashboardData',
  'getMyEntries',
  'getExecutiveDashboard',
  'getCityReport',
  'getFilterLists',
  'getProfile'
];

export const APP_VERSION = '1.0.0';
export const CACHE_NAME = 'nsms-shell-v1';
export const RUNTIME_CACHE_NAME = 'nsms-runtime-v1';

export const DB_NAME = 'nsms_offline_db';
export const DB_VERSION = 1;
export const STORE_MUTATION_QUEUE = 'mutation_queue';
export const STORE_RESPONSE_CACHE = 'response_cache';
export const STORE_META = 'meta';

export const SESSION_STORAGE_KEY = 'nsms_session_v1';
export const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours idle timeout when "Remember Me" is off (sessionStorage)
export const REMEMBER_ME_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days idle timeout when "Remember Me" is on (localStorage)
export const BIOMETRIC_META_KEY = 'nsms_biometric_credential'; // IndexedDB meta key: { crmId, credentialId }

export const SYNC_TAG = 'nsms-sync-mutations';
export const SYNC_RETRY_BASE_MS = 3000;   // exponential backoff base
export const SYNC_RETRY_MAX_MS = 60000;
export const SYNC_MAX_ATTEMPTS = 8;

export const SYNC_STATUS = Object.freeze({
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed'
});

export const NATIONWIDE_ADMIN_IDS = ['jahangir.ali']; // mirrors Code.gs, display-logic only — server remains the source of truth

// Package catalog — mirrors the CATALOG object that was previously defined
// inline in Index.html and duplicated across the wizard and the entries
// edit modal. Single source of truth now; update prices/plans here only.
export const PACKAGE_CATALOG = {
  Home: {
    'Triple Play': [
      { name: 'Triple Play 20 Mbps', mrc: 2075 }, { name: 'Triple Play 30 Mbps', mrc: 2525 },
      { name: 'Triple Play 40 Mbps', mrc: 3750 }, { name: 'Triple Play 50 Mbps', mrc: 4600 },
      { name: 'Triple Play 70 Mbps', mrc: 5600 }, { name: 'Triple Play 100 Mbps', mrc: 7500 },
      { name: 'Triple Play 200 Mbps', mrc: 14300 }, { name: 'Triple Play 350 Mbps', mrc: 24300 }
    ],
    'Standalone': [
      { name: 'Home Unlimited 20M', mrc: 1775 }, { name: 'Home Unlimited 30M', mrc: 2225 },
      { name: 'Home Unlimited 40M', mrc: 3450 }, { name: 'Home Unlimited 50M', mrc: 4300 },
      { name: 'Home Unlimited 70M', mrc: 5300 }, { name: 'Home Unlimited 100M', mrc: 7200 },
      { name: 'Home Unlimited 200M', mrc: 14000 }, { name: 'Home Unlimited 350M', mrc: 24000 }
    ]
  },
  Corporate: {
    'Connect': [
      { name: 'Connect Unlimited 20 Mbps', mrc: 8500 }, { name: 'Connect Unlimited 30 Mbps', mrc: 12500 },
      { name: 'Connect Unlimited 40 Mbps', mrc: 15000 }, { name: 'Connect Unlimited 50 Mbps', mrc: 18000 },
      { name: 'Connect Unlimited 100 Mbps', mrc: 32500 }
    ],
    'Premium': null, 'Dark Fiber': null, 'Lit Fiber': null, 'P2P': null, 'Cloud': null, 'VAS': null
  }
};

export function formatPkr(n) { return 'Rs. ' + Number(n).toLocaleString('en-PK'); }
