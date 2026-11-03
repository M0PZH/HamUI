// Delegated tooltips for any element with data-ham-tooltip="text".
import { h } from '../core/dom.js';

export function bindTooltips(root = document) {
  let tip = null, current = null, timer = 0;
  const show = (el) => {
    current = el;
    if (!tip) { tip = h('div', { class: 'ham-tooltip', role: 'tooltip', id: 'ham-tooltip' }); document.body.appendChild(tip); }
    tip.textContent = el.dataset.hamTooltip;
    el.setAttribute('aria-describedby', 'ham-tooltip');
    const r = el.getBoundingClientRect();
    tip.style.left = '0px'; tip.style.top = '0px';
    tip.classList.add('is-visible');
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    let y = r.top - tr.height - 6;
    if (y < 8) y = r.bottom + 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => {
    clearTimeout(timer);
    if (current) current.removeAttribute('aria-describedby');
    current = null;
    tip?.classList.remove('is-visible');
  };
  const over = (e) => {
    const el = e.target.closest?.('[data-ham-tooltip]');
    if (!el || el === current) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(el), e.type === 'focusin' ? 0 : 350);
  };
  const out = (e) => {
    const el = e.target.closest?.('[data-ham-tooltip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('focusin', over);
  root.addEventListener('focusout', out);
  root.addEventListener('pointerdown', hide);
  return () => {
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerout', out);
    root.removeEventListener('focusin', over);
    root.removeEventListener('focusout', out);
    root.removeEventListener('pointerdown', hide);
    tip?.remove();
  };
}
