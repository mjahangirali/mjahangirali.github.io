// ============================================================================
// components/topbar.js
// Two modes, matching the mockup:
//  - "greeting": Dashboard home - "Good Morning, {name}" + notification bell
//  - "title": every other screen - back arrow + screen title (+ optional
//    trailing action icon, e.g. the filter icon on Reports/Entries)
// ============================================================================
import { escapeHtml } from '../utils/helpers.js';

export function mountTopbar(container, opts) {
  render(container, opts);
  return {
    update(newOpts) { render(container, newOpts); }
  };
}

function greetingLabel() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function render(container, opts) {
  if (opts.mode === 'greeting') {
    container.innerHTML = '<div class="tb-greeting">' +
        '<div>' +
          '<div class="tb-greeting-hi">' + greetingLabel() + ',</div>' +
          '<div class="tb-greeting-name">' + escapeHtml(opts.name || '') + '</div>' +
        '</div>' +
        '<button class="tb-bell" aria-label="Notifications"><span class="material-icons">notifications</span></button>' +
      '</div>';
  } else {
    container.innerHTML = '<div class="tb-title-row">' +
        (opts.onBack ? '<button class="tb-back" aria-label="Back"><span class="material-icons">arrow_back</span></button>' : '<span class="tb-spacer"></span>') +
        '<div class="tb-title">' + escapeHtml(opts.title || '') + '</div>' +
        (opts.action ? '<button class="tb-action" aria-label="' + escapeHtml(opts.action.label) + '"><span class="material-icons">' + opts.action.icon + '</span></button>' : '<span class="tb-spacer"></span>') +
      '</div>';
    if (opts.onBack) container.querySelector('.tb-back').addEventListener('click', opts.onBack);
    if (opts.action) container.querySelector('.tb-action').addEventListener('click', opts.action.onClick);
  }
}
