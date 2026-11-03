// Trend chart: a rolling line of one reading (MER, S-meter, SWR…) with
// optional threshold lines. Newest value on the right.
import { Component } from '../core/dom.js';
import { Surface, frameScheduler } from '../core/canvas.js';
import { onThemeChange, resolveColors } from '../core/theme.js';

const DEFAULTS = {
  points: 240,        // history length
  min: null,          // fixed scale; null = fit the data
  max: null,
  unit: '',
  decimals: 1,
  fill: true,
  thresholds: [],     // [{value, color: 'tx'|'warn'|css, label}]
  label: 'Trend',
};

export class TrendChart extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    this.el.classList.add('ham-trend');
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', this.options.label);
    this.values = [];
    this._sched = frameScheduler(() => this.draw());
    this.surface = new Surface(this.el, { onResize: () => this._sched.request() });
    this.refreshColors();
    this.onDestroy(onThemeChange(() => { this.refreshColors(); this._sched.request(); }));
  }

  refreshColors() {
    this.colors = resolveColors(this.el, ['inset', 'grid', 'accent', 'trace-fill', 'fg', 'fg-faint', 'tx', 'warn', 'rx']);
    this.font = getComputedStyle(this.el).getPropertyValue('--ham-font-mono').trim() || 'monospace';
  }

  push(v) {
    this.values.push(v);
    if (this.values.length > this.options.points) this.values.shift();
    this._sched.request();
  }

  setThresholds(t) { this.options.thresholds = t || []; this._sched.request(); }
  clear() { this.values = []; this._sched.request(); }

  draw() {
    const s = this.surface, ctx = s.ctx, W = s.width, H = s.height, dpr = s.dpr, c = this.colors, o = this.options;
    if (!W || !H) return;
    ctx.fillStyle = c.inset;
    ctx.fillRect(0, 0, W, H);
    const v = this.values;
    const th = o.thresholds.map((t) => t.value);
    let lo = o.min ?? Math.min(...v, ...th), hi = o.max ?? Math.max(...v, ...th);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
    if (o.min == null || o.max == null) { const pad = (hi - lo) * 0.12; if (o.min == null) lo -= pad; if (o.max == null) hi += pad; }
    const padT = 8 * dpr, padB = 8 * dpr, labelW = 40 * dpr;
    const PW = W - labelW;
    const y = (x) => padT + (1 - (x - lo) / (hi - lo)) * (H - padT - padB);

    // grid: 3 lines with labels on the right
    ctx.strokeStyle = c.grid; ctx.lineWidth = dpr;
    ctx.font = `${10 * dpr}px ${this.font}`;
    ctx.fillStyle = c['fg-faint'];
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 2; k++) {
      const val = lo + ((hi - lo) * k) / 2;
      const yy = Math.round(y(val)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(PW, yy); ctx.stroke();
      ctx.fillText(val.toFixed(o.decimals), PW + 6 * dpr, yy);
    }
    // thresholds
    for (const t of o.thresholds) {
      const yy = Math.round(y(t.value)) + 0.5;
      ctx.strokeStyle = c[t.color] || t.color || c.warn;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(PW, yy); ctx.stroke();
      ctx.setLineDash([]);
      if (t.label) { ctx.fillStyle = ctx.strokeStyle; ctx.textBaseline = 'bottom'; ctx.fillText(t.label, 4 * dpr, yy - 2 * dpr); ctx.textBaseline = 'middle'; }
    }
    if (v.length < 2) return;
    const step = PW / (o.points - 1);
    const x0 = PW - (v.length - 1) * step;
    if (o.fill) {
      ctx.beginPath();
      ctx.moveTo(x0, H);
      v.forEach((val, k) => ctx.lineTo(x0 + k * step, y(val)));
      ctx.lineTo(x0 + (v.length - 1) * step, H);
      ctx.closePath();
      ctx.fillStyle = c['trace-fill'];
      ctx.fill();
    }
    ctx.beginPath();
    v.forEach((val, k) => (k ? ctx.lineTo(x0 + k * step, y(val)) : ctx.moveTo(x0, y(val))));
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // endpoint
    const lx = x0 + (v.length - 1) * step, ly = y(v[v.length - 1]);
    ctx.fillStyle = c.accent;
    ctx.beginPath(); ctx.arc(lx, ly, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
  }

  destroy() {
    this._sched.cancel();
    this.surface.destroy();
    super.destroy();
  }
}
