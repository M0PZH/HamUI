// Shared behaviour for frequency-axis instruments (Spectrum, Waterfall):
// data range, shared view, dial/passband/markers, gestures, keyboard,
// readout and theme-aware colors.
import { Component, h } from '../core/dom.js';
import { frameScheduler } from '../core/canvas.js';
import { attachScopeGestures, wheelStepper } from '../core/gestures.js';
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
  markers: [],          // [{hz, passband: [lo, hi] (relative to hz) | width, label, own, dim, color, dashed}]
  interactive: true,
  tuneStep: 10,         // click-to-tune rounding (Hz)
  autoDial: true,       // move the dial on tune (cancel the ham:tune event to prevent)
  dragTune: 'press',    // 'press': press anywhere tunes there and dragging keeps tuning; drag the
                        //   frequency axis to pan · 'passband': drag the passband to tune, elsewhere pans ·
                        //   'always': every drag moves the tune · false: drag pans, click tunes
  wheelTune: false,     // vertical scroll tunes the dial: true (tuneStep per notch) or a step in Hz;
                        //   false leaves it to the page. Shift scrolls pan, ctrl/⌘ zoom either way.
  readout: true,        // pointer frequency readout
  label: null,          // accessible name
};

const COLOR_TOKENS = ['inset', 'surface', 'surface-2', 'accent-fg', 'grid', 'trace', 'trace-fill', 'peak', 'passband', 'dial', 'fg', 'fg-muted', 'fg-faint',
  'accent', 'accent-line', 'tx', 'rx', 'warn', 'border', 'border-strong', 'channel', 'channel-busy'];

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
    this.channel = null;       // selected channel {hz, width, ...} (see Spectrum channels)
    this.transmitting = false; // paints the selected channel in the TX color
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
        tap: (e) => this._tap(e),
        wheel: (e) => this._wheel(e),
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

  setDial(hz) {
    this.dial = hz;
    // tuning away from the selected channel deselects it
    if (this.channel && hz != null && Math.abs(hz - this.channel.hz) > this.channel.width / 2) this.channel = null;
    this.invalidate();
  }
  setPassband(pb) { this.passband = pb; this.invalidate(); }
  setMarkers(markers) { this.markers = markers || []; this.invalidate(); }

  /** Highlight a channel ({hz, width}) without tuning, or pass null to clear. */
  setChannel(ch) { this.channel = ch || null; this.invalidate(); }
  getChannel() { return this.channel; }

  /** Show the selected channel as transmitting (TX color). */
  setTransmitting(on) { this.transmitting = !!on; this.invalidate(); }

  _tap(e) { this.tuneTo(this.clientXToHz(e.clientX)); }

  /** Step per scroll notch for wheel-to-tune, or 0 when off. */
  get wheelTuneStep() {
    const w = this.options.wheelTune;
    return w === true ? this.options.tuneStep || 1 : typeof w === 'number' && w > 0 ? w : 0;
  }

  setWheelTune(step) { this.options.wheelTune = step; }

  _wheel(e) {
    const step = this.wheelTuneStep;
    if (!step || this.dial == null) return false;
    const n = (this._wheelSteps ||= wheelStepper(40))(e);
    // off the step grid, the first notch lands on the next grid point that way
    const base = (n > 0 ? Math.floor : Math.ceil)(this.dial / step + (n > 0 ? 1e-9 : -1e-9)) * step;
    if (n) this.tuneTo(base + n * step, { source: 'wheel', step });
    return true;
  }

  clientXToHz(clientX) {
    const r = this.el.getBoundingClientRect();
    return this.view.hzAt((clientX - r.left) / (r.width || 1));
  }

  /** Programmatic or gesture tune. Emits a cancelable ham:tune {hz, source}. */
  tuneTo(hz, { source = 'click', step = this.options.tuneStep || 1 } = {}) {
    const rounded = Math.round(hz / step) * step;
    if ((source === 'drag' || source === 'wheel') && rounded === this.dial) return;
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
    if (this.channel && this.outlineChannel) {
      ctx.strokeStyle = this.transmitting ? c.tx : c['accent-line'];
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (const hz of [this.channel.hz - this.channel.width / 2, this.channel.hz + this.channel.width / 2]) {
        const x = Math.round(this.xOf(hz, W)) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      ctx.stroke();
    }
    this._drawMarkers(ctx, W, H, dpr);
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

  /** A marker's frequency span [lo, hi] (Hz), or null for a bare line. */
  static markerSpan(m) {
    if (m.passband) return [m.hz + Math.min(m.passband[0], m.passband[1]), m.hz + Math.max(m.passband[0], m.passband[1])];
    if (m.width) return [m.hz - m.width / 2, m.hz + m.width / 2];
    return null;
  }

  /**
   * Markers: other receivers, spots, memories. `own` draws in the accent
   * (like the dial), `dim` greys it out (other users); a passband is shaded
   * on the spectrum and edged on the waterfall. Labels stack in up to three
   * rows so coinciding markers stay readable; the rest is counted as "+n".
   */
  _drawMarkers(ctx, W, H, dpr) {
    const c = this.colors, ms = this.markers;
    if (!ms.length) return;
    const fills = this.markerFill !== 'edges';
    for (const m of ms) {
      const col = m.own ? c.accent : m.dim ? c['fg-muted'] : c[m.color] || m.color || c.warn;
      const span = ScopeBase.markerSpan(m);
      if (span) {
        const x0 = this.xOf(span[0], W), x1 = this.xOf(span[1], W);
        if (x1 >= 0 && x0 <= W) {
          if (fills || !(m.passband || m.own || m.dim)) {
            ctx.globalAlpha = m.own ? 1 : m.dim ? 0.08 : 0.14;
            ctx.fillStyle = m.own ? c.passband : col;
            ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
          } else {
            ctx.globalAlpha = m.own ? 1 : 0.55;
            ctx.strokeStyle = m.own ? c['accent-line'] : col;
            ctx.lineWidth = dpr;
            ctx.setLineDash(m.own ? [] : [3 * dpr, 3 * dpr]);
            ctx.beginPath();
            for (const e of [x0, x1]) { const x = Math.round(e) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
      const x = Math.round(this.xOf(m.hz, W)) + 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = dpr;
      ctx.globalAlpha = m.dim ? 0.7 : 1;
      ctx.setLineDash(m.dashed || m.dim ? [4 * dpr, 3 * dpr] : []);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (this.drawsLabels) this._drawMarkerLabels(ctx, W, dpr);
  }

  _drawMarkerLabels(ctx, W, dpr) {
    const c = this.colors, ROWS = 3, rh = 17 * dpr, pad = 5 * dpr, gap = 3 * dpr, top = 4 * dpr;
    ctx.font = `500 ${10.5 * dpr}px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const rows = Array.from({ length: ROWS }, () => []);
    let hidden = 0;
    // own first, then by frequency: the own label always gets the top row
    const list = this.markers.filter((m) => m.label).sort((a, b) => (!!b.own - !!a.own) || a.hz - b.hz);
    for (const m of list) {
      const xm = this.xOf(m.hz, W);
      if (xm < 0 || xm > W) continue;
      const w = ctx.measureText(m.label).width + 2 * pad;
      let x0 = Math.round(xm) + 3 * dpr;
      if (x0 + w > W - 2 * dpr) x0 = Math.round(xm) - 3 * dpr - w;
      const row = rows.findIndex((r) => r.every((b) => x0 + w + gap < b.x0 || x0 > b.x0 + b.w + gap));
      if (row < 0) { hidden++; continue; }
      rows[row].push({ x0, w });
      const y = top + row * rh, hh = rh - 3 * dpr;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0 + 0.5, y + 0.5, w, hh, 3 * dpr); else ctx.rect(x0 + 0.5, y + 0.5, w, hh);
      if (m.own) {
        ctx.fillStyle = c.accent; ctx.fill();
        ctx.fillStyle = c['accent-fg'];
      } else {
        const col = m.dim ? c['fg-muted'] : c[m.color] || m.color || c.warn;
        ctx.globalAlpha = 0.86; ctx.fillStyle = c.inset; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = m.dim ? c['border-strong'] : col; ctx.lineWidth = dpr; ctx.stroke();
        ctx.fillStyle = col;
      }
      ctx.fillText(m.label, x0 + pad + 0.5, y + hh / 2 + dpr);
    }
    if (hidden) {
      const t = `+${hidden}`;
      ctx.fillStyle = c['fg-faint'];
      ctx.fillText(t, W - ctx.measureText(t).width - 6 * dpr, top + ROWS * rh + 4 * dpr);
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
