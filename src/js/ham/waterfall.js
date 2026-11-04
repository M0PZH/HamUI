// Waterfall: scrolling history of spectrum frames, newest on top.
import { Surface } from '../core/canvas.js';
import { resolveColormap } from '../core/colormap.js';
import { ScopeBase } from './scope-base.js';

const DEFAULTS = {
  rows: 256,           // history depth (frames)
  minDb: -125,         // level mapped to the bottom of the colormap
  maxDb: -75,          // level mapped to the top
  colormap: 'theme',   // 'theme' | 'viridis' | 'inferno' | 'plasma' | 'turbo' | 'gray' | [colors]
  maxWidth: 2048,      // cap on image columns
  passbandAlpha: 0.6,
  markerLabels: true,  // draw marker labels at the top (the spectrum draws its own)
};

export class Waterfall extends ScopeBase {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS, 'ham-waterfall');
    this.drawsLabels = this.options.markerLabels !== false;
    this.markerFill = 'edges'; // passbands of own/dim markers as edge lines, not a wash over the picture
    this.outlineChannel = true; // the selected channel's edges
    this.n = 0;
    this.hist = null;
    this.head = 0;      // next write row
    this.count = 0;     // rows filled
    this.pendingRows = 0;
    this.full = true;   // full repaint needed

    this.image = document.createElement('canvas');
    this.image.className = 'ham-wf-image';
    this.image.setAttribute('aria-hidden', 'true');
    this.el.prepend(this.image);
    this.ictx = this.image.getContext('2d');
    this.img = null;

    this.overlay = new Surface(this.el, { onResize: () => this._resizeImage() });
    this.image.after(this.overlay.canvas);
    this._resizeImage();
  }

  refreshColors() {
    super.refreshColors();
    this.lut = resolveColormap(this.options.colormap, this.el);
    this.full = true;
  }

  _resizeImage() {
    const w = Math.max(1, Math.min(this.options.maxWidth, Math.round(this.el.clientWidth || 1)));
    if (!this.img || this.img.width !== w || this.img.height !== this.options.rows) {
      this.image.width = w;
      this.image.height = this.options.rows;
      this.img = this.ictx.createImageData(w, this.options.rows);
      this._col = new Float32Array(w);
      this.full = true;
    }
    this.invalidate();
  }

  onViewChange() { this.full = true; this.invalidate(); }
  onDataRangeChange() { this.clear(); }

  /** Remove all history. */
  clear() {
    this.hist = null;
    this.n = 0;
    this.count = 0;
    this.head = 0;
    this.full = true;
    this.invalidate();
  }

  /**
   * Append one frame of levels in dB(m).
   * @param {ArrayLike<number>} bins
   * @param {{startHz:number, spanHz:number}} [range]
   */
  push(bins, range) {
    if (range) this.setDataRange(range.startHz, range.spanHz);
    const n = bins.length, rows = this.options.rows;
    if (n !== this.n || !this.hist) {
      this.n = n;
      this.hist = new Float32Array(rows * n);
      this.head = 0;
      this.count = 0;
      this.full = true;
    }
    this.hist.set(bins, this.head * n);
    this.head = (this.head + 1) % rows;
    this.count = Math.min(rows, this.count + 1);
    this.pendingRows++;
    this.invalidate();
  }

  /** Alias so a Waterfall can be fed like a Spectrum. */
  update(bins, range) { this.push(bins, range); }

  setLevels(minDb, maxDb) { this.options.minDb = minDb; this.options.maxDb = maxDb; this.full = true; this.invalidate(); }

  setColormap(spec) { this.options.colormap = spec; this.lut = resolveColormap(spec, this.el); this.full = true; this.invalidate(); }

  /** Set levels from the current history: floor near the noise, top above the strongest signals. */
  autoLevel() {
    if (!this.hist || !this.count) return;
    const sample = [];
    const step = Math.max(1, Math.floor((this.count * this.n) / 4000));
    for (let i = 0; i < this.count * this.n; i += step) sample.push(this.hist[i]);
    sample.sort((a, b) => a - b);
    const q = (p) => sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
    this.setLevels(Math.round(q(0.2) - 3), Math.round(q(0.995) + 3));
  }

  requestOverlay() { this._overlayOnly = true; this.invalidate(); }

  _paintRow(y, histRow) {
    const W = this.img.width, d = this.img.data, lut = this.lut;
    const o = this.options, k = 255 / (o.maxDb - o.minDb);
    let p = y * W * 4;
    if (histRow < 0) {
      for (let x = 0; x < W; x++, p += 4) { d[p] = lut[0]; d[p + 1] = lut[1]; d[p + 2] = lut[2]; d[p + 3] = 255; }
      return;
    }
    const col = this.resample(this.hist, histRow * this.n, this.n, this._col, W);
    for (let x = 0; x < W; x++, p += 4) {
      let t = (col[x] - o.minDb) * k;
      t = t < 0 ? 0 : t > 255 ? 255 : t | 0;
      const c = t * 3;
      d[p] = lut[c]; d[p + 1] = lut[c + 1]; d[p + 2] = lut[c + 2]; d[p + 3] = 255;
    }
  }

  draw() {
    if (!this.img) return;
    const rows = this.options.rows, W = this.img.width;
    if (!this._overlayOnly || this.full || this.pendingRows) {
      const rowOf = (y) => (y < this.count && this.hist ? (this.head - 1 - y + rows * 2) % rows : -1);
      if (this.full || this.pendingRows >= rows) {
        for (let y = 0; y < rows; y++) this._paintRow(y, rowOf(y));
        this.full = false;
      } else if (this.pendingRows) {
        const k = this.pendingRows;
        this.img.data.copyWithin(W * 4 * k, 0, W * 4 * (rows - k));
        for (let y = 0; y < k; y++) this._paintRow(y, rowOf(y));
      }
      this.pendingRows = 0;
      this.ictx.putImageData(this.img, 0, 0);
    }
    this._overlayOnly = false;

    const s = this.overlay;
    s.ctx.clearRect(0, 0, s.width, s.height);
    this.drawOverlay(s.ctx, s.width, s.height, s.dpr, { passbandAlpha: this.options.passbandAlpha });
  }

  destroy() {
    this.overlay.destroy();
    this.image.remove();
    super.destroy();
  }
}
