// RangeSlider: one slider with two handles for a [low, high] window, such as
// the dB range of a spectrum or a waterfall. Drag a handle to move one end,
// drag the bar between them to move both, click a number to type it.
//
//   const r = new RangeSlider(el, { min: -170, max: 0, value: [-128, -62], minGap: 10, unit: 'dBm', label: 'Spectrum range' });
//   r.on('input', (e) => preview(e.detail.value));   // while dragging
//   r.on('change', (e) => save(e.detail.value));     // when a gesture or edit ends
import { Component, h, clamp } from '../core/dom.js';
import { haptics } from '../core/haptics.js';
import { colormaps } from '../core/colormap.js';

const DEFAULTS = {
  min: 0,
  max: 100,
  step: 1,
  value: null,        // [low, high]; default: [min, max]
  minGap: 0,          // the ends stay at least this far apart
  label: null,        // shown above the track, and the handles' accessible names
  unit: '',
  inputs: true,       // the two values as editable numbers in the header
  ticks: 5,           // number of scale labels under the track; 0 for none
  gradient: null,     // fill: null (accent) | colormap name | 'theme' | array of CSS colours
  haptics: true,
};

const fmt = (v) => String(v).replace('-', '−');

/** CSS gradient for a colormap name, 'theme' (--ham-wf-0..4) or an array of colours. */
export function gradientCss(spec) {
  if (!spec) return '';
  let stops;
  if (spec === 'theme') stops = [0, 1, 2, 3, 4].map((i) => `var(--ham-wf-${i})`);
  else if (typeof spec === 'string') stops = (colormaps[spec] || colormaps.gray).map((c) => `rgb(${c.join(' ')})`);
  else stops = spec.map((c) => (Array.isArray(c) ? `rgb(${c.join(' ')})` : c));
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export class RangeSlider extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    for (const k of ['min', 'max', 'step', 'minGap', 'ticks']) o[k] = Number(o[k]);
    if (typeof o.value === 'string') o.value = o.value.split(/[,\s]+/).map(Number);
    this.el.classList.add('ham-rs');
    this._build();
    this.value = [o.min, o.max];
    this.setValue(o.value ?? [o.min, o.max], { silent: true });
    this.setGradient(o.gradient);
    this._bind();
  }

  _build() {
    const o = this.options;
    const name = o.label || 'Range';
    this.lowIn = o.inputs ? h('input', { class: 'ham-rs-num', inputmode: 'decimal', 'aria-label': `${name} low` }) : null;
    this.highIn = o.inputs ? h('input', { class: 'ham-rs-num', inputmode: 'decimal', 'aria-label': `${name} high` }) : null;
    /** Put extra controls (an Auto button…) in here; it sits before the values. */
    this.extra = h('span', { class: 'ham-rs-extra' });
    const head = h('div', { class: 'ham-rs-head' }, [
      h('span', { class: 'ham-rs-label', text: o.label || '' }),
      this.extra,
      o.inputs ? h('span', { class: 'ham-rs-values' }, [this.lowIn, h('span', { text: '…' }), this.highIn, o.unit ? h('span', { class: 'ham-rs-unit', text: o.unit }) : null]) : null,
    ]);
    const handle = (end) => h('div', { class: `ham-rs-thumb is-${end}`, role: 'slider', tabindex: 0, 'aria-label': `${name} ${end}`, 'aria-valuemin': o.min, 'aria-valuemax': o.max });
    this.lowTh = handle('low');
    this.highTh = handle('high');
    this.fill = h('div', { class: 'ham-rs-fill' });
    this.track = h('div', { class: 'ham-rs-track' }, [h('div', { class: 'ham-rs-rail' }), this.fill, this.lowTh, this.highTh]);
    const parts = [];
    if (o.label || o.inputs) parts.push(head);
    parts.push(this.track);
    if (o.ticks > 1) {
      // round values (1, 2, 2.5 or 5 × 10^n apart) at their real positions
      const raw = (o.max - o.min) / (o.ticks - 1);
      const mag = 10 ** Math.floor(Math.log10(raw));
      const every = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((d) => d >= raw * 0.75) ?? 10 * mag;
      const marks = [];
      for (let v = Math.ceil(o.min / every - 1e-9) * every; v <= o.max + 1e-9; v += every) marks.push(+v.toFixed(10));
      parts.push(h('div', { class: 'ham-rs-ticks', 'aria-hidden': 'true' }, marks.map((v, i) => {
        const p = this._pct(v);
        const edge = p < 4 ? 'is-start' : p > 96 ? 'is-end' : null;
        return h('span', { class: edge, style: { left: `${p}%` }, text: fmt(v) + (i === marks.length - 1 && o.unit ? ` ${o.unit}` : '') });
      })));
    }
    this.el.replaceChildren(...parts);
  }

  /** Set [low, high]; ends are snapped to `step` and kept `minGap` apart. Emits change unless silent. */
  setValue([lo, hi], { silent = false, source = 'api', fix = null } = {}) {
    const o = this.options;
    const snap = (v) => {
      const s = Math.round((v - o.min) / o.step) * o.step + o.min;
      return +s.toFixed(10);
    };
    lo = snap(Number(lo)); hi = snap(Number(hi));
    if (!Number.isFinite(lo)) lo = this.value[0];
    if (!Number.isFinite(hi)) hi = this.value[1];
    const gap = Math.min(o.minGap, o.max - o.min);
    if (fix === 'move') {
      const w = hi - lo;
      if (lo < o.min) { lo = o.min; hi = o.min + w; }
      if (hi > o.max) { hi = o.max; lo = o.max - w; }
    } else if (fix === 'low') {
      lo = clamp(lo, o.min, hi - gap);
    } else if (fix === 'high') {
      hi = clamp(hi, lo + gap, o.max);
    } else {
      lo = clamp(lo, o.min, o.max - gap);
      hi = clamp(hi, lo + gap, o.max);
    }
    const changed = lo !== this.value[0] || hi !== this.value[1];
    this.value = [lo, hi];
    this._render();
    if (changed && !silent) this.emit(source === 'drag' ? 'input' : 'change', { value: [lo, hi], source });
    return changed;
  }

  /** Fill the selected part with a colour map (see gradientCss), or the accent with null. */
  setGradient(spec) {
    this.options.gradient = spec;
    const g = gradientCss(spec);
    this.fill.style.background = g;
    this.el.classList.toggle('has-gradient', !!g);
  }

  _pct(v) { const o = this.options; return ((v - o.min) / (o.max - o.min || 1)) * 100; }

  _render() {
    const [lo, hi] = this.value;
    this.track.style.setProperty('--ham-rs-a', `${this._pct(lo)}%`);
    this.track.style.setProperty('--ham-rs-b', `${this._pct(hi)}%`);
    this.lowTh.setAttribute('aria-valuenow', lo);
    this.highTh.setAttribute('aria-valuenow', hi);
    this.lowTh.setAttribute('aria-valuetext', `${fmt(lo)} ${this.options.unit}`.trim());
    this.highTh.setAttribute('aria-valuetext', `${fmt(hi)} ${this.options.unit}`.trim());
    if (this.lowIn && document.activeElement !== this.lowIn) this.lowIn.value = fmt(lo);
    if (this.highIn && document.activeElement !== this.highIn) this.highIn.value = fmt(hi);
  }

  _valueAt(x) {
    const r = this.track.getBoundingClientRect(), o = this.options;
    return o.min + ((x - r.left) / (r.width || 1)) * (o.max - o.min);
  }

  _tick() { if (this.options.haptics) haptics.fire('tick', { source: this }); }

  _bind() {
    let drag = null;
    const end = () => {
      if (!drag) return;
      this.track.classList.remove('is-moving');
      drag.th?.classList.remove('is-active');
      const moved = drag.start[0] !== this.value[0] || drag.start[1] !== this.value[1];
      drag = null;
      if (moved) this.emit('change', { value: [...this.value], source: 'user' });
    };
    this.listen(this.track, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { this.track.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const v = this._valueAt(e.clientX);
      const [lo, hi] = this.value;
      const start = [lo, hi];
      if (e.target === this.fill) {
        drag = { mode: 'move', v0: v, start };
        this.track.classList.add('is-moving');
        return;
      }
      const mode = e.target === this.lowTh ? 'low' : e.target === this.highTh ? 'high' : Math.abs(v - lo) <= Math.abs(v - hi) ? 'low' : 'high';
      const th = mode === 'low' ? this.lowTh : this.highTh;
      th.classList.add('is-active');
      th.focus({ preventScroll: true });
      drag = { mode, start, th };
      if (!e.target.classList.contains('ham-rs-thumb')) this._dragTo(drag, v);
    });
    this.listen(this.track, 'pointermove', (e) => { if (drag) this._dragTo(drag, this._valueAt(e.clientX)); });
    this.listen(this.track, 'pointerup', end);
    this.listen(this.track, 'pointercancel', end);
    this.listen(this.track, 'lostpointercapture', end);

    for (const [th, mode] of [[this.lowTh, 'low'], [this.highTh, 'high']]) {
      this.listen(th, 'keydown', (e) => {
        const o = this.options;
        const big = 10 * o.step;
        const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
        let [lo, hi] = this.value;
        let to;
        if (d) to = (mode === 'low' ? lo : hi) + d * (e.shiftKey ? big : o.step);
        else if (e.key === 'PageUp' || e.key === 'PageDown') to = (mode === 'low' ? lo : hi) + (e.key === 'PageUp' ? big : -big);
        else if (e.key === 'Home') to = o.min;
        else if (e.key === 'End') to = o.max;
        else return;
        e.preventDefault();
        if (mode === 'low') lo = to; else hi = to;
        if (this.setValue([lo, hi], { source: 'user', fix: mode })) this._tick();
      });
    }
    for (const [inp, mode] of [[this.lowIn, 'low'], [this.highIn, 'high']]) {
      if (!inp) continue;
      const commit = () => {
        const v = Number(inp.value.replace('−', '-').replace(',', '.'));
        const [lo, hi] = this.value;
        if (Number.isFinite(v)) this.setValue(mode === 'low' ? [v, hi] : [lo, v], { source: 'user', fix: mode });
        this._render();
        inp.value = fmt(this.value[mode === 'low' ? 0 : 1]);
      };
      this.listen(inp, 'change', commit);
      this.listen(inp, 'focus', () => { inp.value = String(this.value[mode === 'low' ? 0 : 1]); inp.select(); });
      this.listen(inp, 'blur', () => { inp.value = fmt(this.value[mode === 'low' ? 0 : 1]); });
      this.listen(inp, 'keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); inp.select(); }
        else if (e.key === 'Escape') { inp.value = String(this.value[mode === 'low' ? 0 : 1]); inp.blur(); }
      });
    }
  }

  _dragTo(drag, v) {
    let [lo, hi] = this.value;
    let fix = drag.mode;
    if (drag.mode === 'move') {
      const d = v - drag.v0;
      lo = drag.start[0] + d; hi = drag.start[1] + d;
    } else if (drag.mode === 'low') lo = v;
    else hi = v;
    if (this.setValue([lo, hi], { source: 'drag', fix })) this._tick();
  }
}
