// Spectrum (panadapter trace): level vs frequency, with averaging, peak hold,
// dB grid, frequency axis, passband, dial and markers.
import { Surface } from '../core/canvas.js';
import { niceStep, formatAxisHz } from '../core/format.js';
import { ScopeBase } from './scope-base.js';

const DEFAULTS = {
  minDb: -130,
  maxDb: -50,
  averaging: 0.35,     // 0..1 weight of each new frame (1 = no averaging)
  peakHold: true,
  peakDecay: 0.15,     // dB per update
  fill: true,
  grid: true,
  dbStep: 10,          // dB between grid lines; doubled while lines would be closer than 16 px
  axis: true,          // frequency labels along the bottom
  dbLabels: true,
};

export class Spectrum extends ScopeBase {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS, 'ham-spectrum');
    this.drawsLabels = true;
    this.data = null;
    this.avg = null;
    this.peak = null;
    this._col = new Float32Array(0);
    this._colPeak = new Float32Array(0);
    this.surface = new Surface(this.el, { onResize: () => this.invalidate() });
    this.el.prepend(this.surface.canvas);
    this.invalidate();
  }

  /**
   * Feed one frame of levels in dB(m). `bins` spans the data range
   * (startHz .. startHz + spanHz). Pass `range` to change it.
   * @param {ArrayLike<number>} bins
   * @param {{startHz:number, spanHz:number}} [range]
   */
  update(bins, range) {
    if (range) this.setDataRange(range.startHz, range.spanHz);
    const n = bins.length;
    if (!this.data || this.data.length !== n) {
      this.data = new Float32Array(n);
      this.avg = Float32Array.from(bins);
      this.peak = Float32Array.from(bins);
    }
    const a = this.options.averaging;
    const decay = this.options.peakDecay;
    for (let i = 0; i < n; i++) {
      const v = bins[i];
      this.data[i] = v;
      this.avg[i] += (v - this.avg[i]) * a;
      const p = this.peak[i] - decay;
      this.peak[i] = v > p ? v : p;
    }
    this.invalidate();
  }

  onDataRangeChange() { this.data = null; }

  /** Set the vertical scale in dB. */
  setLevels(minDb, maxDb) { this.options.minDb = minDb; this.options.maxDb = maxDb; this.invalidate(); }
  setAveraging(a) { this.options.averaging = a; }
  setPeakHold(on) { this.options.peakHold = on; if (on && this.data) this.peak.set(this.data); this.invalidate(); }
  clearPeak() { if (this.data) this.peak.set(this.data); this.invalidate(); }

  /** The frequency axis along the bottom is where a drag pans in 'press' mode. */
  isPanZone(clientX, clientY) {
    if (!this.options.axis) return false;
    const r = this.el.getBoundingClientRect();
    return clientY - r.top > r.height - 22;
  }

  readoutText(hz, y) {
    const H = this.el.clientHeight - (this.options.axis ? 22 : 0);
    const { minDb, maxDb } = this.options;
    const db = maxDb - (y / H) * (maxDb - minDb);
    const f = (hz / 1e6).toFixed(5);
    return y >= 0 && y <= H ? `${f} MHz · ${db.toFixed(0)} dB` : `${f} MHz`;
  }

  draw() {
    const s = this.surface;
    const ctx = s.ctx, W = s.width, Htot = s.height, dpr = s.dpr;
    if (!W || !Htot) return;
    const o = this.options, c = this.colors;
    const axisH = o.axis ? Math.round(22 * dpr) : 0;
    const H = Htot - axisH;
    const toY = (db) => (1 - (db - o.minDb) / (o.maxDb - o.minDb)) * H;
    // widen the dB step until lines are at least ~16 px apart (short spectra)
    let dbStep = o.dbStep;
    const pxPerDb = H / dpr / (o.maxDb - o.minDb || 1);
    while (dbStep * pxPerDb < 16 && dbStep < 1000) dbStep *= 2;

    ctx.fillStyle = c.inset;
    ctx.fillRect(0, 0, W, Htot);

    // grid
    const fstep = niceStep(this.view.span, W / dpr);
    if (o.grid) {
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let db = Math.ceil(o.minDb / dbStep) * dbStep; db <= o.maxDb; db += dbStep) {
        const y = Math.round(toY(db)) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      for (let f = Math.ceil(this.view.start / fstep) * fstep; f <= this.view.end; f += fstep) {
        const x = Math.round(this.xOf(f, W)) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    this.drawOverlayUnder(ctx, W, H, dpr);

    // trace
    if (this.data) {
      if (this._col.length !== W) { this._col = new Float32Array(W); this._colPeak = new Float32Array(W); }
      const src = o.averaging < 1 ? this.avg : this.data;
      const col = this.resample(src, 0, src.length, this._col, W);
      if (o.fill) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x < W; x++) ctx.lineTo(x, toY(col[x]));
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = c['trace-fill'];
        ctx.fill();
      }
      ctx.beginPath();
      for (let x = 0; x < W; x++) { const y = toY(col[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = c.trace;
      ctx.lineWidth = 1.25 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();

      if (o.peakHold) {
        const pk = this.resample(this.peak, 0, this.peak.length, this._colPeak, W);
        ctx.beginPath();
        for (let x = 0; x < W; x++) { const y = toY(pk[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.strokeStyle = c.peak;
        ctx.lineWidth = dpr;
        ctx.stroke();
      }
    }
    this.drawOverlayOver(ctx, W, H, dpr);
    ctx.restore();

    // dB labels
    ctx.font = `${10 * dpr}px ${this.font}`;
    if (o.dbLabels) {
      ctx.fillStyle = c['fg-faint'];
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      for (let db = Math.ceil(o.minDb / dbStep) * dbStep; db <= o.maxDb; db += dbStep) {
        const y = toY(db);
        if (y < 12 * dpr) continue;
        ctx.fillText(String(db), 6 * dpr, y - 2 * dpr);
      }
    }

    // frequency axis
    if (axisH) {
      ctx.fillStyle = c.inset;
      ctx.fillRect(0, H, W, axisH);
      ctx.fillStyle = c.border;
      ctx.fillRect(0, H, W, Math.max(1, Math.round(dpr)));
      ctx.fillStyle = c['fg-faint'];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const margin = 30 * dpr;
      for (let f = Math.ceil(this.view.start / fstep) * fstep; f <= this.view.end; f += fstep) {
        const x = this.xOf(f, W);
        if (x < margin || x > W - margin) continue;
        ctx.fillText(formatAxisHz(f, fstep), x, H + axisH / 2 + dpr);
      }
      ctx.textAlign = 'left';
    }
  }

  // passband goes under the trace; lines over it
  drawOverlayUnder(ctx, W, H) {
    if (this.dial != null && this.passband) {
      const x0 = this.xOf(this.dial + this.passband[0], W);
      const x1 = this.xOf(this.dial + this.passband[1], W);
      ctx.fillStyle = this.colors.passband;
      ctx.fillRect(x0, 0, x1 - x0, H);
    }
  }

  drawOverlayOver(ctx, W, H, dpr) {
    const pb = this.passband;
    this.passband = null; // already drawn underneath
    this.drawOverlay(ctx, W, H, dpr);
    this.passband = pb;
  }

  destroy() {
    this.surface.destroy();
    super.destroy();
  }
}
