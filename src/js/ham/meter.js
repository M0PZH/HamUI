// Bar meters: S-meter, power, SWR, ALC, or a custom scale.
import { Component, h, clamp } from '../core/dom.js';
import { dbmToS } from '../core/format.js';

// position (0..1) on an S-meter for a dBm value. S9 sits at 60 %.
function sPos(dbm, vhf) {
  const s9 = vhf ? -93 : -73;
  const s0 = s9 - 54;
  if (dbm <= s9) return clamp((dbm - s0) / 54 * 0.6, 0, 0.6);
  return 0.6 + clamp((dbm - s9) / 60, 0, 1) * 0.4;
}

function piecewise(points) {
  return (v) => {
    if (v <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (v <= points[i][0]) {
        const [a, pa] = points[i - 1], [b, pb] = points[i];
        return pa + ((v - a) / (b - a)) * (pb - pa);
      }
    }
    return points[points.length - 1][1];
  };
}

const swrPos = piecewise([[1, 0], [1.5, 0.25], [2, 0.45], [3, 0.7], [5, 0.88], [10, 1]]);

/** Preset scales. Each: map(value)->0..1, labels [[pos,text]], zones [[pos,color]], format(value). */
export const meterPresets = {
  s: (o) => ({
    name: 'S',
    map: (v) => sPos(v, o.vhf),
    labels: [[1 / 15, '1'], [0.2, '3'], [1 / 3, '5'], [7 / 15, '7'], [0.6, '9'], [0.733, '+20'], [1, '+60']],
    zones: [[0, 'accent'], [0.6, 'warn']],
    format: (v) => (o.showDbm === false ? dbmToS(v, o).label : `${dbmToS(v, o).label} ${Math.round(v)}`),
  }),
  power: (o) => {
    const max = o.max ?? 100;
    return {
      name: 'PWR',
      map: (v) => v / max,
      labels: [0, 0.25, 0.5, 0.75, 1].map((p) => [p, `${+(p * max).toFixed(1)}${p === 1 ? 'W' : ''}`]),
      zones: [[0, 'accent']],
      format: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} W`,
    };
  },
  swr: () => ({
    name: 'SWR',
    map: swrPos,
    labels: [[0, '1'], [0.25, '1.5'], [0.45, '2'], [0.7, '3'], [0.88, '5'], [1, '∞']],
    zones: [[0, 'accent'], [0.45, 'warn'], [0.7, 'tx']],
    format: (v) => (v >= 10 ? '∞' : `${v.toFixed(1)}:1`),
  }),
  alc: () => ({
    name: 'ALC',
    map: (v) => v / 100,
    labels: [[0, '0'], [0.5, '50%'], [1, '100%']],
    zones: [[0, 'accent'], [0.5, 'warn']],
    format: (v) => `${Math.round(v)}%`,
  }),
  custom: (o) => {
    const min = o.min ?? 0, max = o.max ?? 100, unit = o.unit ?? '';
    return {
      name: '',
      map: (v) => (v - min) / (max - min),
      labels: o.labels || [0, 0.5, 1].map((p) => [p, `${+(min + p * (max - min)).toFixed(1)}`]),
      zones: [[0, 'accent']],
      format: (v) => `${+v.toFixed(o.decimals ?? 1)}${unit ? ' ' + unit : ''}`,
    };
  },
};

const DEFAULTS = {
  type: 's',            // 's' | 'power' | 'swr' | 'alc' | 'custom'
  label: null,          // overrides the preset name
  value: null,
  segments: 40,         // 0 = smooth bar
  peakHold: true,
  peakHoldMs: 1500,
  off: false,           // dimmed (e.g. PWR while receiving)
  marks: [],            // [{value, label}] reference ticks on the track (thresholds)
};

const colorOf = (c) => (/^[a-z-]+$/.test(c) && !['transparent', 'currentcolor'].includes(c) ? `var(--ham-${c})` : c);

export class Meter extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    const preset = (meterPresets[o.type] || meterPresets.custom)(o);
    this.scale = {
      ...preset,
      ...(o.map ? { map: o.map } : {}),
      ...(o.labels ? { labels: o.labels } : {}),
      ...(o.zones ? { zones: o.zones } : {}),
      ...(o.format ? { format: o.format } : {}),
    };
    this._render();
    this._peak = 0;
    this._peakT = 0;
    this.value = null;
    if (o.value != null) this.set(o.value);
    else this.setOff(o.off, '—');
  }

  _render() {
    const { labels, zones } = this.scale;
    const stops = [];
    zones.forEach(([p, c], i) => {
      const next = zones[i + 1] ? zones[i + 1][0] : 1;
      stops.push(`${colorOf(c)} ${p * 100}%`, `${colorOf(c)} ${next * 100}%`);
    });
    this.el.classList.add('ham-meter');
    if (!this.options.segments) this.el.classList.add('ham-meter-smooth');
    else this.el.style.setProperty('--ham-meter-segs', this.options.segments);
    this.el.setAttribute('role', 'meter');
    this.el.replaceChildren(
      h('span', { class: 'ham-meter-name', text: this.options.label ?? this.scale.name }),
      h('div', { class: 'ham-meter-body' }, [
        h('div', { class: 'ham-meter-scale', 'aria-hidden': 'true' },
          labels.map(([p, t]) => h('span', { style: { left: `${p * 100}%`, transform: `translateX(${p <= 0 ? 0 : p >= 1 ? -100 : -50}%)` }, text: t }))),
        h('div', { class: 'ham-meter-track' }, [
          this.fillEl = h('div', { class: 'ham-meter-fill', style: { background: `linear-gradient(to right, ${stops.join(', ')})` } }),
          h('div', { class: 'ham-meter-segs' }),
          this.peakEl = h('div', { class: 'ham-meter-peak' }),
          (this.marksEl = h('div', { class: 'ham-meter-marks' })),
        ]),
      ]),
      this.valueEl = h('span', { class: 'ham-meter-value' }),
    );
    this.el.setAttribute('aria-label', this.options.label ?? this.scale.name);
    this.setMarks(this.options.marks);
  }

  /** Reference ticks on the track, e.g. [{value: 4.03, label: 'QEF'}]. */
  setMarks(marks = []) {
    this.options.marks = marks;
    this.marksEl.replaceChildren(...marks.map((m) => h('span', {
      class: 'ham-meter-mark',
      title: m.label || '',
      style: { left: `${clamp(this.scale.map(m.value), 0, 1) * 100}%` },
    })));
  }

  /** Set the reading in the meter's units (dBm for S, W, ratio, %). */
  set(value, text) {
    this.value = value;
    const x = clamp(this.scale.map(value), 0, 1);
    this.fillEl.style.clipPath = `inset(0 ${(1 - x) * 100}% 0 0)`;
    if (this.options.peakHold) {
      const now = performance.now();
      if (x >= this._peak || now - this._peakT > this.options.peakHoldMs) { this._peak = x; this._peakT = now; }
      this.peakEl.style.left = `calc(${this._peak * 100}% - 1px)`;
      this.peakEl.style.opacity = this._peak > 0.005 ? 0.7 : 0;
    }
    const label = text ?? this.scale.format(value);
    this.valueEl.textContent = label;
    this.el.setAttribute('aria-valuetext', label);
    this.el.setAttribute('aria-valuenow', String(value));
  }

  /** Dim the meter (e.g. transmit meters while receiving). */
  setOff(off, text) {
    this.options.off = !!off;
    this.el.classList.toggle('is-off', !!off);
    if (off) {
      this.fillEl.style.clipPath = 'inset(0 100% 0 0)';
      this.peakEl.style.opacity = 0;
      this._peak = 0;
      this.valueEl.textContent = text ?? '—';
    }
  }
}
