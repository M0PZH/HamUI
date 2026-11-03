// Demodulator lock progress as a row of steps, e.g. for DVB-S2:
// Search → Header → Demod → FEC → TS. Steps before the current one are
// done (green); the current one is in progress (accent); the rest wait.
import { Component, h } from '../core/dom.js';

const DEFAULTS = {
  steps: ['Search', 'Header', 'Demod', 'FEC', 'TS'],
  stage: 0,            // index of the step in progress; steps.length = fully locked
  label: 'Lock status',
};

export class LockStatus extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    const steps = typeof o.steps === 'string' ? o.steps.split(',').map((x) => x.trim()) : o.steps;
    this.steps = steps;
    this.el.classList.add('ham-lock');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-label', o.label);
    this.items = steps.map((name) => h('li', { class: 'ham-lock-step' }, [h('span', { class: 'ham-lock-dot' }), name]));
    this.el.replaceChildren(h('ol', { class: 'ham-lock-steps' }, this.items));
    this.set(o.stage, { silent: true });
  }

  /** Stage index: 0..steps.length (steps.length means locked). */
  set(stage, { silent = false } = {}) {
    stage = Math.max(0, Math.min(this.steps.length, stage | 0));
    const changed = stage !== this.stage;
    this.stage = stage;
    const locked = stage >= this.steps.length;
    this.items.forEach((li, i) => {
      li.dataset.state = locked || i < stage ? 'done' : i === stage ? 'active' : 'wait';
    });
    this.el.dataset.locked = locked;
    this.el.setAttribute('aria-valuetext', locked ? 'Locked' : `${this.steps[stage]}…`);
    if (changed && !silent) this.emit('change', { stage, locked, step: this.steps[stage] ?? null });
  }

  get locked() { return this.stage >= this.steps.length; }
}
