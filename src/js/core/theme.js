// Theme switching and token reading. Canvas widgets subscribe with
// onThemeChange() and re-resolve their colors.

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const subscribers = new Set();
let observer = null;
let pending = false;

/** The theme attribute in effect for `el`: 'dark' | 'light' | 'auto'. */
export function getTheme(el = document.documentElement) {
  const host = el.closest ? el.closest('[data-theme]') : null;
  return host ? host.dataset.theme : 'dark';
}

/** 'dark' or 'light', resolving 'auto' through the OS setting. */
export function resolvedTheme(el = document.documentElement) {
  const t = getTheme(el);
  if (t === 'auto') return mq && mq.matches ? 'light' : 'dark';
  return t === 'light' ? 'light' : 'dark';
}

export function setTheme(theme, el = document.documentElement) {
  el.dataset.theme = theme;
}

export function toggleTheme(el = document.documentElement) {
  setTheme(resolvedTheme(el) === 'dark' ? 'light' : 'dark', el);
}

function notify() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    for (const fn of subscribers) fn();
    document.dispatchEvent(new CustomEvent('ham:themechange', { detail: { theme: resolvedTheme() } }));
  });
}

function ensureWatching() {
  if (observer) return;
  observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
  mq?.addEventListener('change', notify);
}

/** Call `fn` whenever any data-theme attribute or the OS scheme changes. */
export function onThemeChange(fn) {
  subscribers.add(fn);
  ensureWatching();
  return () => subscribers.delete(fn);
}

/** Read raw --ham-* custom property values as seen from `el`. */
export function readTokens(el, names) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue(`--ham-${n}`).trim();
  return out;
}

/**
 * Resolve tokens (or any CSS colors) to concrete `rgb()/rgba()` strings by
 * letting the browser compute them on a probe element inside `el`. This
 * handles var() chains and color-mix().
 */
export function resolveColors(el, names) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  el.appendChild(probe);
  const out = {};
  for (const n of names) {
    probe.style.color = '';
    probe.style.color = n.startsWith('--') || /^[a-z0-9-]+$/.test(n) && !CSS_NAMED.has(n) ? `var(${n.startsWith('--') ? n : `--ham-${n}`})` : n;
    out[n] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}

const CSS_NAMED = new Set(['transparent', 'black', 'white', 'red', 'green', 'blue', 'currentcolor']);

/** Parse a computed color string to [r, g, b, a] (0–255, a 0–1). */
export function parseColor(str) {
  if (!str) return [0, 0, 0, 1];
  let m = str.match(/^rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = str.match(/^color\(srgb\s+([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
  }
  m = str.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  return [0, 0, 0, 1];
}
