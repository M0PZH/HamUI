// Shared behaviour for frequency-axis instruments (Spectrum, Waterfall):
// data range, shared view, dial/passband/markers, gestures, keyboard,
// readout and theme-aware colors.
import { Component, h } from '../core/dom.js';
import { frameScheduler } from '../core/canvas.js';
import { attachScopeGestures } from '../core/gestures.js';
import { onThemeChange, resolveColors } from '../core/theme.js';
import { formatHz } from '../core/format.js';
import { FrequencyView } from './view.js';

export const SCOPE_DEFAULTS = {
  startHz: null,        // data range start (Hz)
  spanHz: 48000,        // data range width (Hz)
  centerHz: null,       // alternative to startHz
  view: null,           // a FrequencyView to share
  minSpan: 100,         // deepest zoom (Hz)
  dial: null,           // dial frequency (Hz)
  passband: null,       // [lo, hi] relative to dial (Hz)
  markers: [],          // [{hz, color, dashed, label, width}]
  interactive: true,
  tuneStep: 10,         // click-to-tune rounding (Hz)
  autoDial: true,       // move the dial on tune (cancel the ham:tune event to prevent)
  dragTune: 'press',    // 'press': press anywhere tunes there and dragging keeps tuning; drag the
                        //   frequency axis to pan · 'passband': drag the passband to tune, elsewhere pans ·
                        //   'always': every drag moves the tune · false: drag pans, click tunes
  readout: true,        // pointer frequency readout
  label: null,          // accessible name
};

const COLOR_TOKENS = ['inset', 'grid', 'trace', 'trace-fill', 'peak', 'passband', 'dial', 'fg', 'fg-muted', 'fg-faint', 'accent', 'tx', 'rx', 'warn', 'border'];

export class ScopeBase extends Component {
  constructor(el, options, defaults, className) {
    super(el, options, { ...SCOPE_DEFAULTS, ...defaults });
    const o = this.options;
    this.el.classList.add(className);

    const span = o.spanHz;
    const start = o.startHz ?? (o.centerHz != null ? o.centerHz - span / 2 : 0);
    this.dataStart = start;
    this.dataSpan = span;

    this.dial = o.dial;
    this.passband = o.passband;
    this.markers = o.markers || [];
    this.hoverX = -1; // CSS px within element, -1 = none
    this.colors = {};
    this.font = 'monospace';

    this._sched = frameScheduler(() => this.draw());
    this.view = null;
    this.setView(o.view || new FrequencyView({ boundsStart: start, boundsSpan: span, minSpan: o.minSpan }));

    if (o.readout) {
      this.readoutEl = h('div', { class: 'ham-scope-readout', 'aria-hidden': 'true' });
      this.el.appendChild(this.readoutEl);
    }

    if (o.interactive) {
      if (!this.el.hasAttribute('tabindex')) this.el.tabIndex = 0;
      this.onDestroy(attachScopeGestures(this.el, {
        zoom: (f, x) => this.view.zoomAt(f, this.clientXToHz(x)),
        pan: (dx) => this.view.pan((dx / this._cssWidth()) * this.view.span),
        tap: (e) => this.tuneTo(this.clientXToHz(e.clientX)),
        grab: (x, y) => this._grabTune(x, y),
        doubleTap: () => this.view.reset(),
        hover: (x, y) => this._hover(x, y),
        leave: () => this._hover(null),
      }));
      this.listen(this.el, 'keydown', (e) => this._key(e));
    }
    this.el.setAttribute('role', 'application');
    this.el.setAttribute('aria-roledescription', className.replace('ham-', ''));
    if (o.label) this.el.setAttribute('aria-label', o.label);

    this.refreshColors();
    this.onDestroy(onThemeChange(() => { this.refreshColors(); this.invalidate(); }));
  }

  _cssWidth() { return this.el.clientWidth || 1; }

  /** Resolve theme tokens to concrete colors. Subclasses may extend. */
  refreshColors() {
    this.colors = resolveColors(this.el, COLOR_TOKENS);
    const f = getComputedStyle(this.el).getPropertyValue('--ham-font-mono').trim();
    this.font = f || 'monospace';
  }

  /** Full repaint on next frame. */
  invalidate() { this._sched.request(); }
  requestDraw() { this._sched.request(); }

  setView(view) {
    this._unsubView?.();
    this.view = view;
    this._unsubView = view.subscribe(() => {
      this.onViewChange();
      this.emit('viewchange', { start: view.start, span: view.span, zoom: view.zoom });
    });
    this.onViewChange();
  }

  /** Hook for subclasses; default repaints. */
  onViewChange() { this.invalidate(); }

  /** Change the frequency range the incoming bins cover. */
  setDataRange(startHz, spanHz) {
    if (startHz === this.dataStart && spanHz === this.dataSpan) return;
    const overlap = startHz < this.dataStart + this.dataSpan && startHz + spanHz > this.dataStart;
    this.dataStart = startHz;
    this.dataSpan = spanHz;
    this.onDataRangeChange();
    if (this.view.boundsStart !== startHz || this.view.boundsSpan !== spanHz) {
      this.view.setBounds(startHz, spanHz, { reset: !overlap });
    }
    this.invalidate();
  }

  onDataRangeChange() {}

  setDial(hz) { this.dial = hz; this.invalidate(); }
  setPassband(pb) { this.passband = pb; this.invalidate(); }
  setMarkers(markers) { this.markers = markers || []; this.invalidate(); }

  clientXToHz(clientX) {
    const r = this.el.getBoundingClientRect();
    return this.view.hzAt((clientX - r.left) / (r.width || 1));
  }

  /** Programmatic or gesture tune. Emits a cancelable ham:tune {hz, source}. */
  tuneTo(hz, { source = 'click' } = {}) {
    const step = this.options.tuneStep || 1;
    const rounded = Math.round(hz / step) * step;
    if (source === 'drag' && rounded === this.dial) return;
    const ok = this.el.dispatchEvent(new CustomEvent('ham:tune', { detail: { hz: rounded, source }, bubbles: true, cancelable: true }));
    if (ok && this.options.autoDial) this.setDial(rounded);
  }

  /** The drag-to-tune mode in effect: 'passband', 'always' or null. */
  get dragTuneMode() {
    const m = this.options.dragTune;
    return m === true ? 'passband' : ['press', 'passband', 'always'].includes(m) ? m : null;
  }

  setDragTune(mode) { this.options.dragTune = mode; this.el.classList.remove('is-over-tune', 'is-over-pan'); }

  /** Where a drag pans the view in 'press' mode (the spectrum's frequency axis). */
  isPanZone() { return false; }

  /** Is clientX over the passband (or near the dial line when there is none)? */
  isOverTune(clientX) {
    if (this.dial == null) return false;
    const r = this.el.getBoundingClientRect();
    const hzPerPx = this.view.span / (r.width || 1);
    const hz = this.clientXToHz(clientX);
    const pad = 6 * hzPerPx;
    const [lo, hi] = this.passband ? [this.dial + Math.min(...this.passband), this.dial + Math.max(...this.passband)] : [this.dial, this.dial];
    return hz >= lo - pad && hz <= hi + pad;
  }

  _grabTune(clientX, clientY) {
    const mode = this.dragTuneMode;
    if (mode === 'press') {
      if (this.isPanZone(clientX, clientY)) return null;
      return {
        press: () => this.tuneTo(this.clientXToHz(clientX), { source: 'click' }),
        move: (x) => this.tuneTo(this.clientXToHz(x), { source: 'drag' }),
      };
    }
    if (!mode || this.dial == null || (mode === 'passband' && !this.isOverTune(clientX))) return null;
    const startDial = this.dial;
    const x0 = clientX;
    return {
      move: (x) => {
        const hz = startDial + ((x - x0) / this._cssWidth()) * this.view.span;
        this.tuneTo(hz, { source: 'drag' });
      },
    };
  }

  _hover(clientX, clientY) {
    if (clientX == null) {
      this.hoverX = -1;
      this.el.classList.remove('is-hover', 'is-over-tune', 'is-over-pan');
    } else {
      const mode = this.dragTuneMode;
      if (mode === 'passband') this.el.classList.toggle('is-over-tune', this.isOverTune(clientX));
      if (mode === 'press') this.el.classList.toggle('is-over-pan', this.isPanZone(clientX, clientY));
      const r = this.el.getBoundingClientRect();
      this.hoverX = clientX - r.left;
      this.el.classList.add('is-hover');
      const hz = this.view.hzAt(this.hoverX / (r.width || 1));
      if (this.readoutEl) this.readoutEl.textContent = this.readoutText(hz, clientY - r.top);
      this.emit('hover', { hz });
    }
    this.requestOverlay();
  }

  readoutText(hz) { return formatHz(hz, { unit: 'MHz', decimals: 5 }); }

  /** Subclasses with a separate overlay can override for a cheaper repaint. */
  requestOverlay() { this.invalidate(); }

  _key(e) {
    const v = this.view;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': v.pan(-v.span * (e.shiftKey ? 0.5 : 0.1)); break;
      case 'ArrowRight': v.pan(v.span * (e.shiftKey ? 0.5 : 0.1)); break;
      case '+': case '=': v.zoomAt(1.5, this.dial ?? v.center); break;
      case '-': case '_': v.zoomAt(1 / 1.5, this.dial ?? v.center); break;
      case 'Home': case '0': v.reset(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  /** x (backing px) of a frequency. */
  xOf(hz, W) { return this.view.frac(hz) * W; }

  /** Passband, dial, markers and hover line. */
  drawOverlay(ctx, W, H, dpr, { passbandAlpha = 1 } = {}) {
    const c = this.colors;
    if (this.dial != null && this.passband) {
      const x0 = this.xOf(this.dial + this.passband[0], W);
      const x1 = this.xOf(this.dial + this.passband[1], W);
      ctx.globalAlpha = passbandAlpha;
      ctx.fillStyle = c.passband;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.globalAlpha = 1;
    }
    for (const m of this.markers) {
      const col = c[m.color] || m.color || c.warn;
      if (m.width) {
        const x0 = this.xOf(m.hz - m.width / 2, W), x1 = this.xOf(m.hz + m.width / 2, W);
        ctx.globalAlpha = 0.14; ctx.fillStyle = col; ctx.fillRect(x0, 0, x1 - x0, H); ctx.globalAlpha = 1;
      }
      const x = Math.round(this.xOf(m.hz, W)) + 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = dpr;
      ctx.setLineDash(m.dashed ? [4 * dpr, 4 * dpr] : []);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      if (m.label && this.drawsLabels) {
        ctx.fillStyle = col;
        ctx.font = `${10 * dpr}px ${this.font}`;
        ctx.textBaseline = 'top';
        ctx.fillText(m.label, x + 4 * dpr, 4 * dpr);
      }
    }
    if (this.dial != null) {
      const x = Math.round(this.xOf(this.dial, W)) + 0.5;
      ctx.strokeStyle = c.dial;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.hoverX >= 0) {
      const x = Math.round(this.hoverX * dpr) + 0.5;
      ctx.strokeStyle = c['fg-faint'];
      ctx.setLineDash([2 * dpr, 3 * dpr]);
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /**
   * Resample `src` (offset `off`, `n` bins over the data range) into `out`
   * (one value per output column of width W). Takes the max when several
   * bins fall in one column, interpolates when zoomed past bin resolution.
   */
  resample(src, off, n, out, W) {
    const v = this.view;
    const binsPerHz = n / this.dataSpan;
    const b0base = (v.start - this.dataStart) * binsPerHz;
    const bpp = (v.span * binsPerHz) / W; // bins per output column
    if (bpp >= 1) {
      for (let x = 0; x < W; x++) {
        let i0 = Math.floor(b0base + x * bpp), i1 = Math.ceil(b0base + (x + 1) * bpp);
        if (i0 < 0) i0 = 0;
        if (i1 > n) i1 = n;
        let m = -Infinity;
        for (let i = i0; i < i1; i++) { const s = src[off + i]; if (s > m) m = s; }
        out[x] = m === -Infinity ? src[off + Math.max(0, Math.min(n - 1, i0))] : m;
      }
    } else {
      for (let x = 0; x < W; x++) {
        const b = b0base + (x + 0.5) * bpp - 0.5;
        let i = Math.floor(b);
        const f = b - i;
        if (i < 0) i = 0; else if (i > n - 2) i = n - 2;
        const a = src[off + i], c = src[off + i + 1];
        out[x] = a + (c - a) * f;
      }
    }
    return out;
  }

  destroy() {
    this._sched.cancel();
    this._unsubView?.();
    this.readoutEl?.remove();
    super.destroy();
  }
}
