// Rotary knob (AF/RF gain, squelch, power…). Drag up/down, scroll, or use arrow keys.
// `endless: true` makes a VFO-style knob with no ends: a fixed ring of dots,
// a pointer that turns by one detent per step, and ham:change {delta, steps,
// value} per step; while turning it shows the steps of this turn (+12).
import { Component, h, clamp } from '../core/dom.js';
import { wheelStepper } from '../core/gestures.js';
import { haptics } from '../core/haptics.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DEFAULTS = {
  min: 0,
  max: 100,
  step: 1,
  value: 50,
  label: '',
  unit: '',
  format: null,       // (value) => string
  defaultValue: null, // double-click resets to this (default: midpoint)
  size: 'md',         // 'sm' | 'md' | 'lg'
  dragRange: 150,     // px of vertical drag for the full range
  haptics: 'auto',    // true: tick every step · 'auto': tick when there are few steps · false: off
  hapticSteps: 32,    // 'auto' ticks every step up to this many steps; above it only at the ends
  endless: false,     // no ends: relative tuning (value is a running total)
  detentPx: 6,        // endless: px of vertical drag per step
};
const DETENT = 15;    // endless: degrees the pointer turns per step

const A0 = -135, A1 = 135, R = 24.5, C = 26;
const pt = (a, rad = R) => { const r = ((a - 90) * Math.PI) / 180; return [C + rad * Math.cos(r), C + rad * Math.sin(r)]; };
const arc = (a, b) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M${x0} ${y0}A${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
const svg = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

export class Knob extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.value = o.endless ? +(options.value ?? this.el.dataset.value ?? 0) : this._q(o.value);
    this.el.classList.add('ham-knob');
    if (o.size !== 'md') this.el.classList.add(`ham-knob-${o.size}`);

    this.svg = svg('svg', { viewBox: '0 0 52 52', tabindex: '0', role: 'slider', 'aria-label': o.label || 'Knob' });
    if (o.endless) this._buildEndless();
    else this._buildRange();
    this.valueEl = h('span', { class: 'ham-knob-value' });
    this.el.replaceChildren(this.svg, this.valueEl, o.label ? h('span', { class: 'ham-knob-label', text: o.label }) : '');
    this._bind();
    this.render();
  }

  _buildEndless() {
    this.el.classList.add('ham-knob-endless');
    this.angle = 0;
    this.turn = 0;
    const ring = svg('g', { 'aria-hidden': 'true' });
    for (let i = 0; i < 24; i++) {
      const [x, y] = pt(i * DETENT, 23.5);
      const major = i % 6 === 0;
      ring.append(svg('circle', { cx: x, cy: y, r: major ? 1.3 : 0.8, fill: major ? 'var(--ham-fg-muted)' : 'var(--ham-fg-faint)' }));
    }
    this.ptrEl = svg('circle', { cx: C, cy: 13, r: 2.2, fill: 'var(--ham-fg)' });
    this.svg.append(svg('circle', { cx: C, cy: C, r: 20, fill: 'var(--ham-surface-2)', stroke: 'var(--ham-border-strong)' }), ring, this.ptrEl);
  }

  _buildRange() {
    const o = this.options;
    this.svg.setAttribute('aria-valuemin', o.min);
    this.svg.setAttribute('aria-valuemax', o.max);
    this.svg.append(
      svg('circle', { cx: C, cy: C, r: 20, fill: 'var(--ham-surface-2)', stroke: 'var(--ham-border-strong)' }),
      svg('path', { d: arc(A0, A1), fill: 'none', stroke: 'var(--ham-border-strong)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      (this.arcEl = svg('path', { fill: 'none', stroke: 'var(--ham-accent)', 'stroke-width': 3, 'stroke-linecap': 'round' })),
      (this.ptrEl = svg('line', { x1: C, y1: C, x2: C, y2: 12, stroke: 'var(--ham-fg)', 'stroke-width': 2, 'stroke-linecap': 'round' })),
    );
  }

  _q(v) {
    const { min, max, step, endless } = this.options;
    if (endless) return v;
    return clamp(Math.round((v - min) / step) * step + min, min, max);
  }

  render() {
    if (this.options.endless) return this._renderEndless();
    const { min, max, format, unit } = this.options;
    const t = (this.value - min) / (max - min || 1);
    const a = A0 + t * (A1 - A0);
    this.arcEl.setAttribute('d', t > 0.001 ? arc(A0, a) : '');
    this.ptrEl.setAttribute('transform', `rotate(${a} ${C} ${C})`);
    const text = typeof format === 'function' ? format(this.value) : `${+this.value.toFixed(4)}${unit ? ' ' + unit : ''}`;
    this.valueEl.textContent = text;
    this.svg.setAttribute('aria-valuenow', this.value);
    this.svg.setAttribute('aria-valuetext', text);
  }

  _renderEndless() {
    const { step, unit, format } = this.options;
    this.ptrEl.setAttribute('transform', `rotate(${this.angle} ${C} ${C})`);
    const idle = typeof format === 'function' ? format(this.value) : `${+step.toFixed(4)}${unit ? ' ' + unit : ''}`;
    const turning = this.turn !== 0;
    this.valueEl.textContent = turning ? `${this.turn > 0 ? '+' : ''}${this.turn}` : idle;
    this.valueEl.classList.toggle('is-delta', turning);
    this.svg.setAttribute('aria-valuetext', `${idle} per step`);
  }

  /** Endless: turn by n steps (user input): emits ham:change {delta, steps, value}. */
  turnBy(n, { silent = false } = {}) {
    if (!n) return;
    const o = this.options;
    this.angle = (this.angle + n * DETENT) % 360;
    this.turn += n;
    this.value += n * o.step;
    clearTimeout(this._idle);
    this._idle = setTimeout(() => { this.turn = 0; this.render(); }, 900);
    this.render();
    if (!silent) this.emit('change', { value: this.value, delta: n * o.step, steps: n });
    if (o.haptics) haptics.fire('tick', { source: this });
  }

  set(v, { silent = false } = {}) {
    const q = this._q(v);
    if (q === this.value) return;
    this.value = q;
    this.render();
    if (!silent) this.emit('change', { value: q });
  }

  get() { return this.value; }

  /** A user-driven change: set, then give haptic feedback for it. */
  _input(v, kind = null) {
    const o = this.options;
    const before = this.value;
    this.set(v);
    if (!o.haptics || this.value === before) return;
    const steps = Math.round((o.max - o.min) / o.step);
    if (kind) haptics.fire(kind, { source: this });
    else if (this.value === o.min || this.value === o.max) haptics.fire('edge', { source: this });
    else if (o.haptics === true || steps <= o.hapticSteps) haptics.fire('tick', { source: this });
  }

  _bind() {
    const o = this.options;
    if (o.endless) return this._bindEndless();
    const stepper = wheelStepper(20);
    this.listen(this.svg, 'wheel', (e) => { e.preventDefault(); const n = stepper(e); if (n) this._input(this.value + n * o.step); }, { passive: false });
    this.listen(this.svg, 'keydown', (e) => {
      const big = Math.max(o.step, (o.max - o.min) / 10);
      const map = { ArrowUp: o.step, ArrowRight: o.step, ArrowDown: -o.step, ArrowLeft: -o.step, PageUp: big, PageDown: -big };
      if (e.key in map) { this._input(this.value + map[e.key]); e.preventDefault(); }
      else if (e.key === 'Home') { this._input(o.min); e.preventDefault(); }
      else if (e.key === 'End') { this._input(o.max); e.preventDefault(); }
    });
    this.listen(this.svg, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.svg.setPointerCapture?.(e.pointerId);
      const y0 = e.clientY, v0 = this.value;
      const move = (ev) => this._input(v0 + ((y0 - ev.clientY) / o.dragRange) * (o.max - o.min));
      const up = () => {
        this.svg.removeEventListener('pointermove', move);
        this.svg.removeEventListener('pointerup', up);
        this.svg.removeEventListener('pointercancel', up);
      };
      this.svg.addEventListener('pointermove', move);
      this.svg.addEventListener('pointerup', up);
      this.svg.addEventListener('pointercancel', up);
    });
    this.listen(this.svg, 'dblclick', () => this._input(o.defaultValue ?? (o.min + o.max) / 2, 'snap'));
  }

  _bindEndless() {
    const o = this.options;
    const stepper = wheelStepper(20);
    this.listen(this.svg, 'wheel', (e) => { e.preventDefault(); this.turnBy(stepper(e)); }, { passive: false });
    this.listen(this.svg, 'keydown', (e) => {
      const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (e.key in map) { this.turnBy(map[e.key]); e.preventDefault(); }
    });
    this.listen(this.svg, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.svg.setPointerCapture?.(e.pointerId);
      let y0 = e.clientY;
      const move = (ev) => {
        const n = Math.trunc((y0 - ev.clientY) / o.detentPx);
        if (n) { y0 -= n * o.detentPx; this.turnBy(n); }
      };
      const up = () => {
        this.svg.removeEventListener('pointermove', move);
        this.svg.removeEventListener('pointerup', up);
        this.svg.removeEventListener('pointercancel', up);
      };
      this.svg.addEventListener('pointermove', move);
      this.svg.addEventListener('pointerup', up);
      this.svg.addEventListener('pointercancel', up);
    });
  }

  destroy() { clearTimeout(this._idle); super.destroy(); }
}
