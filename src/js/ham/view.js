// The visible frequency window of a scope. Share one FrequencyView between
// a spectrum and a waterfall to keep them aligned while zooming/panning.
import { clamp } from '../core/dom.js';

export class FrequencyView {
  /**
   * @param {object} o
   * @param {number} o.boundsStart  lowest frequency available (Hz)
   * @param {number} o.boundsSpan   width of available data (Hz)
   * @param {number} [o.start]      initial visible start (default boundsStart)
   * @param {number} [o.span]       initial visible span (default boundsSpan)
   * @param {number} [o.minSpan]    deepest zoom (Hz, default 100)
   */
  constructor({ boundsStart = 0, boundsSpan = 1, start, span, minSpan = 100 } = {}) {
    this.boundsStart = boundsStart;
    this.boundsSpan = boundsSpan;
    this.minSpan = minSpan;
    this.start = start ?? boundsStart;
    this.span = span ?? boundsSpan;
    this._subs = new Set();
    this._clamp();
  }

  get end() { return this.start + this.span; }
  get center() { return this.start + this.span / 2; }
  get zoom() { return this.boundsSpan / this.span; }

  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _changed() { for (const fn of this._subs) fn(this); }

  _clamp() {
    this.span = clamp(this.span, Math.min(this.minSpan, this.boundsSpan), this.boundsSpan);
    this.start = clamp(this.start, this.boundsStart, this.boundsStart + this.boundsSpan - this.span);
  }

  /** Change the available data range. Keeps the current window when it still fits unless reset. */
  setBounds(start, span, { reset = false } = {}) {
    const same = start === this.boundsStart && span === this.boundsSpan;
    this.boundsStart = start;
    this.boundsSpan = span;
    if (reset) { this.start = start; this.span = span; }
    this._clamp();
    if (!same || reset) this._changed();
  }

  set({ start = this.start, span = this.span } = {}) {
    this.start = start; this.span = span; this._clamp(); this._changed();
  }

  /** Zoom by `factor` (>1 = in) keeping `anchorHz` under the same screen position. */
  zoomAt(factor, anchorHz = this.center) {
    const t = (anchorHz - this.start) / this.span;
    this.span = this.span / factor;
    this._clamp();
    this.start = anchorHz - t * this.span;
    this._clamp();
    this._changed();
  }

  pan(dHz) { this.start += dHz; this._clamp(); this._changed(); }

  /** Center on `hz` without zooming. */
  centerOn(hz) { this.start = hz - this.span / 2; this._clamp(); this._changed(); }

  /** Make sure `hz` is visible, panning the minimum amount. */
  reveal(hz, marginFrac = 0.05) {
    const m = this.span * marginFrac;
    if (hz < this.start + m) this.pan(hz - m - this.start);
    else if (hz > this.end - m) this.pan(hz + m - this.end);
  }

  reset() { this.start = this.boundsStart; this.span = this.boundsSpan; this._changed(); }

  /** 0..1 position of a frequency in the window. */
  frac(hz) { return (hz - this.start) / this.span; }
  hzAt(frac) { return this.start + frac * this.span; }
}

/** Make `b` (and any further scopes) use the same view as `a`. */
export function linkView(a, ...others) {
  for (const o of others) o.setView(a.view);
  return a.view;
}
