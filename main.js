// ============================================================================
// main.js - composition root
// Wires together everything built in prior modules: PWA install/update,
// session/auth, the mobile app-shell chrome (bottom nav + contextual top
// bar), and page routing between the mountable page modules.
// ============================================================================
import { initPwa, pwaEvents, promptInstall, applyPendingUpdate } from './services/pwa-installer.js';
import { attemptAutoLogin, authEvents } from './services/auth.js';
import { retryFailedNow } from './services/sync.js';
import { showToast } from './components/toast.js';
import { mountSyncPill } from './components/loader.js';
import { mountBottomNav } from './components/bottomnav.js';
import { mountTopbar } from './components/topbar.js';
import { mountLoginPage } from './pages/login.js';
import { mountDashboardPage } from './pages/dashboard.js';
import { mountWizardPage } from './pages/wizard.js';
import { mountEntriesPage } from './pages/entries.js';
import { mountReportsPage } from './pages/reports.js';
import { mountProfilePage } from './pages/profile.js';
import { mountTargetsPage } from './pages/targets.js';

// ---- page registry: view id -> { mount, css, title, action } --------------
const PAGES = {
  dashboard: { mount: mountDashboardPage, css: ['./styles/dashboard.css'] },
  wizard: { mount: mountWizardPage, css: ['./styles/wizard.css'], title: 'New Entry' },
  entries: { mount: mountEntriesPage, css: ['./styles/entries.css'], title: 'Entries', action: { icon: 'filter_list', label: 'Filter' } },
  reports: { mount: mountReportsPage, css: ['./styles/reports.css'], title: 'Reports', action: { icon: 'filter_list', label: 'Filter' } },
  profile: { mount: mountProfilePage, css: ['./styles/profile.css'], title: 'Profile' },
  targets: { mount: mountTargetsPage, css: ['./styles/profile.css'], title: 'Targets' }
};

const loadedStyles = new Set();
function loadStyle(href) {
  if (loadedStyles.has(href)) return Promise.resolve();
  loadedStyles.add(href);
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

let bottomNavCtrl = null;
let topbarCtrl = null;
let currentPage = null;
let currentProfile = null;

const appRoot = document.getElementById('appRoot');
const splash = document.getElementById('splash');

boot();

async function boot() {
  await initPwa();
  wirePwaEvents();
  wireAuthEvents();

  const profile = await attemptAutoLogin();
  hideSplash();

  if (profile) startApp(profile);
  else showLoginScreen();
}

function hideSplash() {
  if (!splash) return;
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 250);
}

function showLoginScreen() {
  currentPage?.unmount?.();
  currentPage = null;
  currentProfile = null;
  bottomNavCtrl = null;
  topbarCtrl = null;

  appRoot.innerHTML = '<div id="loginRoot"></div>';
  loadStyle('./styles/login.css').then(() => {
    mountLoginPage(document.getElementById('loginRoot'), { onSuccess: startApp });
  });
}

function startApp(profile) {
  currentProfile = profile;
  appRoot.innerHTML =
    '<div class="app-shell">' +
      '<div id="topbarRoot"></div>' +
      '<div class="app-content" id="pageRoot"></div>' +
      '<nav class="bn-wrap" id="bottomNavRoot"></nav>' +
    '</div>';
  loadStyle('./styles/shell.css');

  const initialView = new URLSearchParams(window.location.search).get('view') ||
    (window.location.hash || '').replace('#/', '') || 'dashboard';
  const startView = PAGES[initialView] ? initialView : 'dashboard';

  bottomNavCtrl = mountBottomNav(document.getElementById('bottomNavRoot'), {
    active: startView,
    onNavigate: navigate
  });
  topbarCtrl = mountTopbar(document.getElementById('topbarRoot'), { mode: 'greeting', name: profile.empName || profile.crmId });

  navigate(startView);
  mountFloatingSyncPill();

  window.addEventListener('nsms:navigate', (e) => navigate(e.detail.view));
}

async function navigate(viewId) {
  const page = PAGES[viewId];
  if (!page) return;

  currentPage?.unmount?.();
  await Promise.all(page.css.map(loadStyle));

  const root = document.getElementById('pageRoot');
  root.innerHTML = '';

  const props = {
    crmId: currentProfile.crmId, empName: currentProfile.empName, profile: currentProfile,
    sapNumber: currentProfile.sapNumber, empCity: currentProfile.empCity,
    mobileNumber: currentProfile.mobileNumber, email: currentProfile.email,
    onSubmitted: () => navigate('dashboard')
  };

  currentPage = page.mount(root, props);
  bottomNavCtrl?.setActive(viewId);

  if (viewId === 'dashboard') {
    topbarCtrl?.update({ mode: 'greeting', name: currentProfile.empName || currentProfile.crmId });
  } else {
    topbarCtrl?.update({
      mode: 'title', title: page.title || '', onBack: () => navigate('dashboard'),
      action: page.action ? { ...page.action, onClick: () => showToast(page.action.label + ' - coming soon in this view.') } : null
    });
  }

  window.history.replaceState(null, '', '#/' + viewId);
}

let syncPillMounted = false;
function mountFloatingSyncPill() {
  if (syncPillMounted) return;
  syncPillMounted = true;
  const container = document.createElement('div');
  container.className = 'floating-sync-pill';
  document.body.appendChild(container);
  mountSyncPill(container, { onRetry: retryFailedNow });
}

function wireAuthEvents() {
  authEvents.addEventListener('session-expired', () => {
    showToast('Your session expired - please sign in again.', { type: 'error', duration: 5000 });
    showLoginScreen();
  });
}

function wirePwaEvents() {
  let installOffered = false;

  pwaEvents.addEventListener('installable', (e) => {
    if (installOffered || sessionStorage.getItem('nsms_install_dismissed')) return;
    installOffered = true;

    if (e.detail.platform === 'ios-manual') {
      showToast('Install NSMS: tap Share, then "Add to Home Screen".', {
        duration: 8000,
        action: { label: 'Got it', onClick: () => sessionStorage.setItem('nsms_install_dismissed', '1') }
      });
    } else {
      showToast('Install NSMS for faster access and offline use.', {
        duration: 8000,
        action: { label: 'Install', onClick: () => promptInstall() }
      });
    }
  });

  pwaEvents.addEventListener('update-available', () => {
    showToast('A new version of NSMS is available.', {
      duration: 0,
      action: { label: 'Reload', onClick: () => applyPendingUpdate() }
    });
  });
}
