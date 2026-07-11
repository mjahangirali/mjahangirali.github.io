// ============================================================================
// components/toast.js
// Framework-free toast notifications. One stack, stable across page
// navigations (mounted once by the app shell, imported wherever needed).
// ============================================================================

let stackEl = null;

function ensureStack() {
  if (stackEl && document.body.contains(stackEl)) return stackEl;
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  stackEl.setAttribute('role', 'status');
  stackEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(stackEl);
  return stackEl;
}

/**
 * @param {string} message
 * @param {object} [opts]
 * @param {'default'|'success'|'error'} [opts.type]
 * @param {number} [opts.duration] ms, 0 = persists until dismissed
 * @param {{label:string, onClick:Function}} [opts.action]
 */
export function showToast(message, opts = {}) {
  const { type = 'default', duration = 3200, action = null } = opts;
  const stack = ensureStack();

  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'default' ? ` toast-${type}` : '');
  el.textContent = message;

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { action.onClick(); dismiss(); };
    el.appendChild(btn);
  }

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  function dismiss() {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }

  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

export const toastSuccess = (msg, opts) => showToast(msg, { ...opts, type: 'success' });
export const toastError = (msg, opts) => showToast(msg, { ...opts, type: 'error' });
