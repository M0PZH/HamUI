// Constellation (I/Q scatter) with persistence: symbols accumulate into a
// density map that fades over time, drawn through the waterfall colormap.
// Ideal points for the current modulation are overlaid.
import { Component, h } from '../core/dom.js';
import { Surface, frameScheduler } from '../core/canvas.js';
import { resolveColormap } from '../core/colormap.js';
import { onThemeChange, resolveColors } from '../core/theme.js';
import { attachScopeGestures } from '../core/gestures.js';
import { constellationPoints, measureMer } from './dvbs2.js';

const DEFAULTS = {
  modulation: 'QPSK',   // 'QPSK' | '8PSK' | '16APSK' | '32APSK' | null (no overlay)
  rate: null,           // code rate, picks APSK ring ratios
  range: 1.6,           // half-width of the plot in unit-power symbols
  resolution: 160,      // density grid cells per side
  persistence: 0.82,    // density kept per push (0 = none, 0.95 = long trails)
  normalize: true,      // scale input to unit average power
  colormap: 'theme',
  showIdeal: true,
  showMer: true,        // MER readout, decision-directed against the overlay
  label: 'Constellation',
  interactive: true,    // pinch / ctrl+wheel zoom, double-click reset
};

export class Constellation extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.el.classList.add('ham-constellation');
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', o.label);
    this.range = o.range;
    this.n = o.resolution;
    this.density = new Float32Array(this.n * this.n);
    this.peak = 1;
    this.power = 1;
    this.mer = NaN;
    this.grid = document.createElement('canvas');
    this.grid.width = this.grid.height = this.n;
    this.gctx = this.grid.getContext('2d');
    this.img = this.gctx.createImageData(this.n, this.n);

    this._sched = frameScheduler(() => this.draw());
    this.surface = new Surface(this.el, { onResize: () => this._sched.request() });
    this.readout = h('div', { class: 'ham-constellation-readout', 'aria-live': 'off' });
    this.el.append(this.readout);
    this.setModulation(o.modulation, o.rate);

    if (o.interactive) {
      this.onDestroy(attachScopeGestures(this.el, {
        zoom: (f) => { this.range = Math.min(4, Math.max(0.4, this.range / f)); this._sched.request(); },
        pan: () => {},
        doubleTap: () => { this.range = o.range; this._sched.request(); },
      }));
    }
    this.refreshColors();
    this.onDestroy(onThemeChange(() => { this.refreshColors(); this._sched.request(); }));
  }

  refreshColors() {
    this.colors = resolveColors(this.el, ['inset', 'grid', 'fg', 'fg-muted', 'fg-faint', 'border-strong']);
    this.lut = resolveColormap(this.options.colormap, this.el);
    this.font = getComputedStyle(this.el).getPropertyValue('--ham-font-mono').trim() || 'monospace';
  }

  /** Change the overlay (and the MER reference). */
  setModulation(modulation, rate = this.options.rate) {
    this.options.modulation = modulation;
    this.options.rate = rate;
    this.ideal = modulation ? constellationPoints(modulation, rate) : [];
    this.mer = NaN;
    this.rings = [...new Set(this.ideal.map(([i, q]) => Math.hypot(i, q).toFixed(3)))].map(Number);
    this._sched?.request();
  }

  setColormap(spec) { this.options.colormap = spec; this.lut = resolveColormap(spec, this.el); this._sched.request(); }

  clear() { this.density.fill(0); this.peak = 1; this.mer = NaN; this._sched.request(); }

  /**
   * Add a block of symbols, interleaved [i0, q0, i1, q1, ...].
   * Any scale works when `normalize` is on.
   */
  push(iq) {
    const o = this.options, n = this.n, d = this.density;
    const count = iq.length >> 1;
    if (!count) return;
    if (o.normalize) {
      let p = 0;
      for (let k = 0; k < iq.length; k++) p += iq[k] * iq[k];
      this.power += ((p / count) - this.power) * 0.3;
    }
    const s = o.normalize ? 1 / Math.sqrt(this.power || 1) : 1;
    // fade
    const keep = o.persistence;
    let peak = 0;
    for (let k = 0; k < d.length; k++) { d[k] *= keep; }
    // accumulate (fixed full-scale so zooming does not rescale history)
    const full = 2.4, half = n / 2, cell = half / full;
    for (let k = 0; k < count; k++) {
      const x = Math.floor(iq[2 * k] * s * cell + half);
      const y = Math.floor(-iq[2 * k + 1] * s * cell + half);
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      d[y * n + x] += 1;
    }
    for (let k = 0; k < d.length; k++) if (d[k] > peak) peak = d[k];
    this.peak += (Math.max(1, peak) - this.peak) * 0.2;
    if (o.showMer && this.ideal.length) {
      const scaled = new Float32Array(iq.length);
      for (let k = 0; k < iq.length; k++) scaled[k] = iq[k] * s;
      const m = measureMer(scaled, this.ideal);
      this.mer = Number.isFinite(this.mer) ? this.mer + (m - this.mer) * 0.2 : m;
    }
    this._sched.request();
  }

  draw() {
    const s = this.surface, ctx = s.ctx, W = s.width, H = s.height, dpr = s.dpr, c = this.colors;
    if (!W || !H) return;
    ctx.fillStyle = c.inset;
    ctx.fillRect(0, 0, W, H);
    const size = Math.min(W, H), ox = (W - size) / 2, oy = (H - size) / 2;
    const px = size / (2 * this.range);         // pixels per unit
    const cx = W / 2, cy = H / 2;

    // density image: grid covers ±2.4 units
    const n = this.n, d = this.density, img = this.img.data, lut = this.lut;
    const norm = 1 / Math.log1p(this.peak);
    for (let k = 0, p = 0; k < d.length; k++, p += 4) {
      const v = d[k] > 0.02 ? Math.log1p(d[k]) * norm : 0;
      const t = Math.min(255, (v * 255) | 0);
      img[p] = lut[t * 3]; img[p + 1] = lut[t * 3 + 1]; img[p + 2] = lut[t * 3 + 2];
      img[p + 3] = v > 0 ? Math.min(255, 60 + v * 400) : 0;
    }
    this.gctx.putImageData(this.img, 0, 0);
    const span = 2.4 * 2 * px;
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();

    // axes and rings
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(ox, cy + 0.5); ctx.lineTo(ox + size, cy + 0.5);
    ctx.moveTo(cx + 0.5, oy); ctx.lineTo(cx + 0.5, oy + size);
    ctx.stroke();
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    for (const r of this.rings.length ? this.rings : [1]) {
      ctx.beginPath(); ctx.arc(cx, cy, r * px, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.drawImage(this.grid, cx - span / 2, cy - span / 2, span, span);

    // ideal points
    if (this.options.showIdeal) {
      ctx.strokeStyle = c.fg;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = dpr;
      const a = 3.5 * dpr;
      ctx.beginPath();
      for (const [i, q] of this.ideal) {
        const x = cx + i * px, y = cy - q * px;
        ctx.moveTo(x - a, y); ctx.lineTo(x + a, y);
        ctx.moveTo(x, y - a); ctx.lineTo(x, y + a);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // labels
    ctx.font = `${10 * dpr}px ${this.font}`;
    ctx.fillStyle = c['fg-faint'];
    ctx.textBaseline = 'top';
    ctx.fillText('I', ox + size - 10 * dpr, cy + 4 * dpr);
    ctx.fillText('Q', cx + 5 * dpr, oy + 4 * dpr);
    const o = this.options;
    const mod = o.modulation ? `${o.modulation}${o.rate ? ' ' + o.rate : ''}` : '';
    this.readout.textContent = [mod, o.showMer && Number.isFinite(this.mer) ? `MER ${this.mer.toFixed(1)} dB` : ''].filter(Boolean).join(' · ');
  }

  destroy() {
    this._sched.cancel();
    this.surface.destroy();
    this.readout.remove();
    super.destroy();
  }
}
