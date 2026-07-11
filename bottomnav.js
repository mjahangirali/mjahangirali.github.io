// ============================================================================
// components/bottomnav.js
// Fixed bottom tab bar — replaces the old desktop top-nav (components/
// navbar.js) for the mobile-mockup redesign. Five tabs matching the
// reference screens: Dashboard, New Entry, Entries, Reports, Profile.
// ============================================================================

export const TABS = [
  { id: 'dashboard', icon: 'home', label: 'Dashboard' },
  { id: 'wizard', icon: 'add_circle', label: 'New Entry' },
  { id: 'entries', icon: 'list_alt', label: 'Entries' },
  { id: 'reports', icon: 'bar_chart', label: 'Reports' },
  { id: 'profile', icon: 'person', label: 'Profile' }
];

export function mountBottomNav(container, { active, onNavigate }) {
  container.innerHTML = TABS.map((t) => `
    <button class="bn-item${t.id === active ? ' active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
      <span class="material-icons">${t.icon}</span>
      <span class="bn-label">${t.label}</span>
    </button>
  `).join('');

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate(btn.dataset.tab));
  });

  return {
    setActive(id) {
      container.querySelectorAll('.bn-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    }
  };
}
