// toast({title, body, tone, timeout}) -> {close()}
// tone: 'info' | 'success' | 'warn' | 'error' | 'rx' | 'tx'
import { h } from '../core/dom.js';

let region = null;
function getRegion() {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'ham-toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
  }
  return region;
}

export function toast(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  const { title = '', body = '', tone = 'info', timeout = 4000, closable = true } = o;
  const el = h('div', { class: `ham-toast ham-toast-${tone} is-entering` }, [
    h('span', { class: 'ham-dot' }),
    h('div', { class: 'ham-toast-content' }, [title, body ? h('small', { text: body }) : null]),
    closable ? h('button', { class: 'ham-toast-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => close() }) : null,
  ]);
  getRegion().appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-entering')));
  let timer = timeout ? setTimeout(close, timeout) : 0;
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { if (timeout) timer = setTimeout(close, timeout / 2); });
  function close() {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  }
  return { el, close };
}
