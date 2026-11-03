// Constellation (I/Q scatter) with persistence: symbols accumulate into a
// density map that fades over time, drawn through the waterfall colormap.
// Ideal points for the current modulation are overlaid.
//
// The density grid covers exactly the visible area at (by default) one cell
// per device pixel, and each symbol is splatted bilinearly into its four
// nearest cells, so points stay sharp at any size or zoom.
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
  resolution: 'auto',   // density cells per side; 'auto' = device pixels (128–1024)
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
    this.n = 0;
    this.peak = 1;
    this.power = 1;
    this.mer = NaN;
    this.grid = document.createElement('canvas');
    this.gctx = this.grid.getContext('2d');

    this._sched = frameScheduler(() => this.draw());
    this.surface = new Surface(this.el, { onResize: () => this._layout() });
    this.readout = h('div', { class: 'ham-constellation-readout', 'aria-live': 'off' });
    this.el.append(this.readout);
    this.setModulation(o.modulation, o.rate);
    this._layout();

    if (o.interactive) {
      this.onDestroy(attachScopeGestures(this.el, {
        zoom: (f) => this.setRange(this.range / f),
        pan: () => {},
        doubleTap: () => this.setRange(o.range),
      }));
    }
    this.refreshColors();
    this.onDestroy(onThemeChange(() => { this.refreshColors(); this._sched.request(); }));
  }

  /** Size the density grid to the plot. Changing size or zoom starts a fresh history. */
  _layout() {
    const s = this.surface;
    if (!s) return; // called once from inside the Surface constructor
    const size = Math.min(s.width, s.height);
    const res = this.options.resolution;
    const n = res === 'auto' ? Math.max(128, Math.min(1024, Math.round(size))) : Math.max(16, res | 0);
    if (n !== this.n) {
      this.n = n;
      this.density = new Float32Array(n * n);
      this.grid.width = this.grid.height = n;
      this.img = this.gctx.createImageData(n, n);
      this.peak = 1;
    }
    this._sched.request();
  }

  /** Zoom: half-width of the plot in unit-power symbols (0.4–4). */
  setRange(range) {
    const r = Math.min(4, Math.max(0.4, range));
    if (r === this.range) return;
    this.range = r;
    this.density.fill(0);
    this.peak = 1;
    this._sched.request();
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
    this._sched.request();
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
    if (!count || !n) return;
    if (o.normalize) {
      let p = 0;
      for (let k = 0; k < iq.length; k++) p += iq[k] * iq[k];
      this.power += ((p / count) - this.power) * 0.3;
    }
    const s = o.normalize ? 1 / Math.sqrt(this.power || 1) : 1;
    const keep = o.persistence;
    for (let k = 0; k < d.length; k++) d[k] *= keep;

    // splat each symbol as a small soft dot (3×3 tent, sub-cell positioned)
    const cell = n / (2 * this.range), half = n / 2;
    for (let k = 0; k < count; k++) {
      const fx = iq[2 * k] * s * cell + half;
      const fy = -iq[2 * k + 1] * s * cell + half;
      const x = Math.round(fx), y = Math.round(fy);
      if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
      const dx = fx - x, dy = fy - y;           // -0.5 … 0.5
      const wx0 = 0.5 - dx * 0.5, wx2 = 0.5 + dx * 0.5;   // left / right weights, centre = 1
      const wy0 = 0.5 - dy * 0.5, wy2 = 0.5 + dy * 0.5;
      const p = y * n + x;
      d[p - n - 1] += wy0 * wx0 * 0.5; d[p - n] += wy0 * 0.5; d[p - n + 1] += wy0 * wx2 * 0.5;
      d[p - 1] += wx0 * 0.5;           d[p] += 1;           d[p + 1] += wx2 * 0.5;
      d[p + n - 1] += wy2 * wx0 * 0.5; d[p + n] += wy2 * 0.5; d[p + n + 1] += wy2 * wx2 * 0.5;
    }
    let peak = 0;
    for (let k = 0; k < d.length; k++) if (d[k] > peak) peak = d[k];
    this.peak += (Math.max(0.5, peak) - this.peak) * 0.2;

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
    if (!W || !H || !this.n) return;
    ctx.fillStyle = c.inset;
    ctx.fillRect(0, 0, W, H);
    const size = Math.min(W, H), ox = (W - size) / 2, oy = (H - size) / 2;
    const px = size / (2 * this.range);         // pixels per unit
    const cx = W / 2, cy = H / 2;

    // axes and rings
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(ox, Math.round(cy) + 0.5); ctx.lineTo(ox + size, Math.round(cy) + 0.5);
    ctx.moveTo(Math.round(cx) + 0.5, oy); ctx.lineTo(Math.round(cx) + 0.5, oy + size);
    ctx.stroke();
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    for (const r of this.rings.length ? this.rings : [1]) {
      ctx.beginPath(); ctx.arc(cx, cy, r * px, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);

    // density image (log scale, transparent where empty)
    const d = this.density, img = this.img.data, lut = this.lut;
    const norm = 1 / Math.log1p(this.peak);
    for (let k = 0, p = 0; k < d.length; k++, p += 4) {
      if (d[k] < 0.04) { img[p + 3] = 0; continue; }
      const v = Math.min(1, Math.log1p(d[k]) * norm) ** 0.7;
      const t = ((0.3 + v * 0.7) * 255) | 0;     // skip the darkest end so single hits stay visible
      img[p] = lut[t * 3]; img[p + 1] = lut[t * 3 + 1]; img[p + 2] = lut[t * 3 + 2];
      img[p + 3] = Math.min(255, 110 + v * 300);
    }
    this.gctx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = this.n < size * 0.9;
    ctx.drawImage(this.grid, ox, oy, size, size);

    // ideal points
    if (this.options.showIdeal) {
      ctx.strokeStyle = c.fg;
      ctx.globalAlpha = 0.6;
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
