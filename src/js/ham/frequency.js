// Frequency / VFO display with per-digit tuning:
//   wheel or two-finger scroll over a digit, drag a digit up/down,
//   or focus and use ←/→ to pick a digit and ↑/↓ to change it.
import { Component, h, clamp } from '../core/dom.js';
import { wheelStepper } from '../core/gestures.js';
import { haptics } from '../core/haptics.js';

const DEFAULTS = {
  value: 14074000,   // Hz
  min: 0,
  max: 999999999,
  digits: 9,         // digits shown (9 = up to 999.999.999 Hz)
  subDigits: 3,      // trailing digits drawn muted (the Hz group)
  minPlace: 0,       // smallest tunable place (1 = 10 Hz steps)
  size: 'md',        // 'sm' | 'md' | 'lg' | 'xl'
  unit: null,        // e.g. 'MHz' label after the digits
  editable: true,
  label: 'Frequency',
  haptics: true,     // haptic tick per tuning step (see HamUI.haptics)
};

export class FrequencyDisplay extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.value = clamp(Math.round(o.value), o.min, o.max);
    this.cursor = -1; // keyboard-selected place
    this._build();
    this.render();
    if (o.editable) this._bind();
  }

  _build() {
    const o = this.options;
    this.el.classList.add('ham-freq');
    if (o.size && o.size !== 'md') this.el.classList.add(`ham-freq-${o.size}`);
    this.el.classList.toggle('is-editable', !!o.editable);
    this.el.setAttribute('role', o.editable ? 'spinbutton' : 'status');
    this.el.setAttribute('aria-label', o.label);
    if (o.editable && !this.el.hasAttribute('tabindex')) this.el.tabIndex = 0;
    this.el.replaceChildren();
    this.digitEls = [];
    for (let p = o.digits - 1; p >= 0; p--) {
      const d = h('span', { class: 'ham-freq-d', 'data-place': p });
      this.digitEls.push(d);
      this.el.appendChild(d);
      if (p > 0 && p % 3 === 0) this.el.appendChild(h('span', { class: 'ham-freq-sep', text: '.' }));
    }
    if (o.unit) this.el.appendChild(h('span', { class: 'ham-freq-unit', text: o.unit }));
  }

  render() {
    const o = this.options;
    const str = String(this.value).padStart(o.digits, '0');
    let lead = true;
    this.digitEls.forEach((d, i) => {
      const place = o.digits - 1 - i;
      const ch = str[i];
      if (ch !== '0' || place <= 6) lead = false; // always show from the MHz digit down
      d.textContent = ch;
      d.classList.toggle('is-lead', lead);
      d.classList.toggle('is-sub', place < o.subDigits);
      d.classList.toggle('is-cursor', place === this.cursor);
    });
    this.el.setAttribute('aria-valuenow', String(this.value));
    this.el.setAttribute('aria-valuetext', `${(this.value / 1e6).toFixed(6)} MHz`);
  }

  /** Set the frequency in Hz. Emits ham:change unless silent. */
  set(hz, { silent = false, source = 'api' } = {}) {
    const v = clamp(Math.round(hz), this.options.min, this.options.max);
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (!silent) this.emit('change', { hz: v, source });
  }

  get() { return this.value; }

  /** Step by `n` units of `place` (10^place Hz). */
  step(place, n, source = 'user') {
    const o = this.options;
    place = Math.max(place, o.minPlace);
    const before = this.value;
    this.set(before + n * 10 ** place, { source });
    if (o.haptics && source !== 'api' && this.value !== before) {
      haptics.fire(this.value === o.min || this.value === o.max ? 'edge' : 'tick', { source: this });
    }
  }

  setTx(on) { this.el.dataset.tx = on ? 'true' : 'false'; }

  _placeOf(target) {
    const d = target.closest?.('.ham-freq-d');
    return d ? Number(d.dataset.place) : null;
  }

  _bind() {
    const stepper = wheelStepper(40);
    this.listen(this.el, 'wheel', (e) => {
      const place = this._placeOf(e.target);
      if (place == null) return;
      e.preventDefault();
      const n = stepper(e);
      if (n) this.step(place, n, 'wheel');
    }, { passive: false });

    this.listen(this.el, 'pointerdown', (e) => {
      const place = this._placeOf(e.target);
      if (place == null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.el.setPointerCapture?.(e.pointerId);
      let y0 = e.clientY;
      const pxPerStep = e.pointerType === 'touch' ? 18 : 14;
      const move = (ev) => {
        const dy = y0 - ev.clientY;
        if (Math.abs(dy) >= pxPerStep) {
          const n = Math.trunc(dy / pxPerStep);
          this.step(place, n, 'drag');
          y0 -= n * pxPerStep;
        }
      };
      const up = () => {
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
      };
      this.el.addEventListener('pointermove', move);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    });

    this.listen(this.el, 'focus', () => {
      if (this.cursor < 0) this.cursor = Math.max(this.options.minPlace, 3);
      this.render();
    });
    this.listen(this.el, 'blur', () => { this.cursor = -1; this.render(); });
    this.listen(this.el, 'keydown', (e) => {
      const o = this.options;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': this.cursor = Math.min(o.digits - 1, this.cursor + 1); this.render(); break;
        case 'ArrowRight': this.cursor = Math.max(o.minPlace, this.cursor - 1); this.render(); break;
        case 'ArrowUp': this.step(this.cursor, 1, 'key'); break;
        case 'ArrowDown': this.step(this.cursor, -1, 'key'); break;
        case 'PageUp': this.step(this.cursor, 10, 'key'); break;
        case 'PageDown': this.step(this.cursor, -10, 'key'); break;
        default:
          if (/^[0-9]$/.test(e.key) && this.cursor >= 0) {
            // overwrite the selected digit, then move right
            const p = 10 ** this.cursor;
            const cur = Math.floor(this.value / p) % 10;
            this.set(this.value + (Number(e.key) - cur) * p, { source: 'key' });
            this.cursor = Math.max(o.minPlace, this.cursor - 1);
            this.render();
          } else handled = false;
      }
      if (handled) e.preventDefault();
    });
  }
}
