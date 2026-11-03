// MER meter for DVB-S2 receivers. The bar is red below the Es/N0 the
// current MODCOD needs, amber within `warnMargin` of it and green above.
// The value cell shows MER and the decoding margin ("D").
import { Meter } from './meter.js';
import { h } from '../core/dom.js';
import { getModcod } from './dvbs2.js';

export class MerMeter extends Meter {
  /**
   * options.modcod: "QPSK 2/3" etc.   options.min/max: scale in dB (default -2 … 20)
   * options.warnMargin: dB above threshold still shown amber (default 1.5)
   */
  constructor(el, options = {}) {
    const min = options.min ?? -2, max = options.max ?? 20;
    super(el, {
      type: 'custom', label: 'MER', min, max, unit: 'dB',
      labels: [0, 5, 10, 15, 20].filter((v) => v >= min && v <= max).map((v) => [(v - min) / (max - min), String(v)]),
      format: (v) => `${v.toFixed(1)} dB`,
      ...options,
    });
    this.el.classList.add('ham-mer');
    this.subEl = h('span', { class: 'ham-meter-sub' });
    this.valueEl.after(this.subEl);
    this.valueCell = h('span', { class: 'ham-meter-value-stack' });
    this.valueEl.replaceWith(this.valueCell);
    this.valueCell.append(this.valueEl, this.subEl);
    this.setModcod(this.options.modcod ?? 'QPSK 1/2');
  }

  setModcod(modcod) {
    this.modcod = typeof modcod === 'string' ? getModcod(modcod) : modcod;
    const o = this.options, th = this.modcod?.esn0 ?? o.min;
    const pos = (v) => Math.min(1, Math.max(0, (v - o.min) / (o.max - o.min)));
    this.scale.zones = [[0, 'tx'], [pos(th), 'warn'], [pos(th + (o.warnMargin ?? 1.5)), 'rx']];
    const stops = [];
    this.scale.zones.forEach(([p, c], i) => {
      const next = this.scale.zones[i + 1] ? this.scale.zones[i + 1][0] : 1;
      stops.push(`var(--ham-${c}) ${p * 100}%`, `var(--ham-${c}) ${next * 100}%`);
    });
    this.fillEl.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    this.setMarks(this.modcod ? [{ value: th, label: `${this.modcod.name} needs ${th.toFixed(2)} dB` }] : []);
    if (this.value != null) this.set(this.value);
  }

  setOff(off, text) {
    super.setOff(off, text);
    if (off && this.subEl) { this.subEl.textContent = ''; this.subEl.dataset.tone = ''; }
  }

  set(value, text) {
    super.set(value, text);
    if (!this.subEl) return;
    const d = this.modcod ? value - this.modcod.esn0 : NaN;
    this.subEl.textContent = Number.isFinite(d) ? `D ${d >= 0 ? '' : '−'}${Math.abs(d).toFixed(1)}` : '';
    this.subEl.dataset.tone = !Number.isFinite(d) ? '' : d < 0 ? 'tx' : d < (this.options.warnMargin ?? 1.5) ? 'warn' : 'rx';
  }
}
