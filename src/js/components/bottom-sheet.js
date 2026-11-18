// BottomSheet: a panel along the bottom of a container that the user drags
// (or clicks, or keys) between a few heights, e.g. hidden / peek / open.
// The container is a flex column; the sheet takes its height from the content
// above it instead of covering it.
//
//   <div class="theatre" style="display:flex; flex-direction:column; height:100vh">
//     <div class="stage" style="flex:1; min-height:0">…</div>
//     <div id="sheet">…peek line… …tabs…</div>
//   </div>
//   const sheet = new BottomSheet('#sheet', { snap: 'peek', key: 'i' });
//   sheet.on('change', (e) => save(e.detail.snap));
import { Component, h } from '../core/dom.js';
import { haptics } from '../core/haptics.js';

const DEFAULTS = {
  snaps: { hidden: 20, peek: 112, open: 0.54 }, // px, or a fraction of the container's height
  snap: 'peek',
  cycle: null,          // order for clicks and keys (default: the order of `snaps`)
  key: null,            // a key that cycles the sheet from anywhere on the page, e.g. 'i'
  max: 0.85,            // a drag stops at this fraction of the container
  flick: 0.5,           // px/ms: a faster release goes on to the next position
  label: 'Panel',
  haptics: true,
};

/** The position to settle on after a drag: the nearest, or the next one in the flick's direction. */
export function settleSnap(heights, h, velocity = 0, flick = 0.5) {
  const order = Object.entries(heights).sort((a, b) => a[1] - b[1]);
  let i = 0;
  order.forEach(([, v], k) => { if (Math.abs(v - h) < Math.abs(order[i][1] - h)) i = k; });
  if (velocity > flick && order[i][1] <= h) i = Math.min(order.length - 1, i + 1);
  else if (velocity < -flick && order[i][1] >= h) i = Math.max(0, i - 1);
  return order[i][0];
}

export class BottomSheet extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.el.classList.add('ham-sheet');
    this.handle = h('div', { class: 'ham-sheet-handle', role: 'button', tabindex: 0, 'aria-label': `${o.label}: drag, or press to show more` }, [h('i')]);
    this.el.prepend(this.handle);
    this.snap = o.snaps[o.snap] != null ? o.snap : Object.keys(o.snaps)[0];
    this._bind();
    this._ro = new ResizeObserver(() => { if (!this._drag) this._apply(); });
    this._ro.observe(this.el.parentElement || this.el);
    this.onDestroy(() => this._ro.disconnect());
    this._apply();
  }

  get order() { return this.options.cycle || Object.keys(this.options.snaps); }

  /** Height in px of a position now. */
  heightOf(name) {
    const v = this.options.snaps[name];
    const H = this.el.parentElement?.clientHeight || innerHeight;
    return Math.round(v > 0 && v <= 1 ? v * H : v);
  }

  /** Move to a position. Emits ham:change {snap, source} when it changes. */
  setSnap(name, { source = 'api' } = {}) {
    if (this.options.snaps[name] == null) return;
    const prev = this.snap;
    this.snap = name;
    this._apply();
    if (name !== prev) {
      if (source !== 'api' && this.options.haptics) haptics.fire('snap', { source: this });
      this.emit('change', { snap: name, previous: prev, source });
    }
  }

  /** The next position in the cycle (wrapping). */
  next({ source = 'api' } = {}) {
    const o = this.order;
    this.setSnap(o[(o.indexOf(this.snap) + 1) % o.length], { source });
  }

  _apply(h = this.heightOf(this.snap)) {
    this.el.style.setProperty('--ham-sheet-h', `${h}px`);
    this.el.dataset.snap = this._drag ? this._near(h) : this.snap;
    const o = this.order;
    this.handle.setAttribute('aria-expanded', String(this.snap !== o[0]));
  }

  _near(h) {
    const hs = Object.fromEntries(Object.keys(this.options.snaps).map((k) => [k, this.heightOf(k)]));
    return settleSnap(hs, h);
  }

  _bind() {
    const hd = this.handle;
    this.listen(hd, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { hd.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const now = performance.now();
      this._drag = { id: e.pointerId, y: e.clientY, h0: this.el.getBoundingClientRect().height, moved: false, v: 0, ly: e.clientY, lt: now };
    });
    this.listen(hd, 'pointermove', (e) => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      const dy = d.y - e.clientY;
      if (!d.moved && Math.abs(dy) < 4) return;
      if (!d.moved) { d.moved = true; this.el.classList.add('is-dragging'); }
      const H = this.el.parentElement?.clientHeight || innerHeight;
      const h = Math.max(this.heightOf(this.order[0]), Math.min(H * this.options.max, d.h0 + dy));
      const now = performance.now();
      d.v = 0.6 * ((d.ly - e.clientY) / Math.max(1, now - d.lt)) + 0.4 * d.v;   // px/ms, upwards positive
      d.ly = e.clientY; d.lt = now;
      this._apply(h);
    });
    const end = (e) => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      this._drag = null;
      this.el.classList.remove('is-dragging');
      if (!d.moved) { this.next({ source: 'user' }); return; }
      const h = this.el.getBoundingClientRect().height;
      const hs = Object.fromEntries(Object.keys(this.options.snaps).map((k) => [k, this.heightOf(k)]));
      const to = settleSnap(hs, h, performance.now() - d.lt > 120 ? 0 : d.v, this.options.flick);
      if (to === this.snap) this._apply(); else this.setSnap(to, { source: 'user' });
    };
    this.listen(hd, 'pointerup', end);
    this.listen(hd, 'pointercancel', end);
    this.listen(hd, 'keydown', (e) => {
      const o = Object.keys(this.options.snaps).sort((a, b) => this.heightOf(a) - this.heightOf(b));
      const i = o.indexOf(this.snap);
      if (e.key === 'Enter' || e.key === ' ') this.next({ source: 'user' });
      else if (e.key === 'ArrowUp') this.setSnap(o[Math.min(o.length - 1, i + 1)], { source: 'user' });
      else if (e.key === 'ArrowDown') this.setSnap(o[Math.max(0, i - 1)], { source: 'user' });
      else return;
      e.preventDefault();
    });
    if (this.options.key) {
      const k = String(this.options.key).toLowerCase();
      this.listen(document, 'keydown', (e) => {
        if (e.key.toLowerCase() !== k || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.('input, select, textarea, [contenteditable], [role="slider"]')) return;
        if (!this.el.isConnected || !this.el.offsetParent) return;
        e.preventDefault();
        this.next({ source: 'user' });
      });
    }
  }
}
