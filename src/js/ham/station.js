// Small station widgets: UTC clock, TX/RX indicator, PTT button.
import { Component } from '../core/dom.js';

/* ---- Clock ---- */
const clocks = new Set();
let timer = 0;
function tick() { const now = new Date(); for (const c of clocks) c.render(now); }

export class Clock extends Component {
  constructor(el, options = {}) {
    super(el, options, { utc: true, seconds: true, date: false, suffix: '' });
    this.el.classList.add('ham-clock');
    clocks.add(this);
    if (!timer) timer = setInterval(tick, 1000);
    this.render(new Date());
  }

  render(d) {
    const o = this.options;
    const iso = o.utc ? d.toISOString() : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
    let t = iso.slice(11, o.seconds ? 19 : 16);
    if (o.date) t = `${iso.slice(0, 10)} ${t}`;
    this.el.textContent = t + (o.suffix || '');
    this.el.setAttribute('datetime', d.toISOString());
  }

  destroy() {
    clocks.delete(this);
    if (!clocks.size) { clearInterval(timer); timer = 0; }
    super.destroy();
  }
}

/* ---- TX/RX indicator ---- */
export class TxIndicator extends Component {
  constructor(el, options = {}) {
    super(el, options, { state: 'rx' });
    this.el.classList.add('ham-trx');
    this.el.setAttribute('role', 'status');
    this.set(this.options.state);
  }

  /** 'rx' | 'tx' | 'off' */
  set(state) {
    this.state = state;
    this.el.dataset.state = state;
    this.el.textContent = state === 'off' ? 'OFF' : state.toUpperCase();
  }
}

/* ---- PTT ---- */
export class Ptt extends Component {
  /**
   * options.mode: 'momentary' (hold to transmit, default) or 'toggle'.
   * Space bar works while focused. Emits ham:ptt {on}.
   */
  constructor(el, options = {}) {
    super(el, options, { mode: 'momentary', label: 'PTT', txLabel: 'TX' });
    const b = this.el;
    b.classList.add('ham-btn', 'ham-ptt');
    if (b.tagName === 'BUTTON') b.type = 'button';
    this.on_ = false;
    this.set(false, { silent: true });
    const o = this.options;
    if (o.mode === 'toggle') {
      this.listen(b, 'click', () => this.set(!this.on_));
    } else {
      this.listen(b, 'pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        b.focus();
        this.set(true);
      });
      this.listen(b, 'pointerup', () => this.set(false));
      this.listen(b, 'pointercancel', () => this.set(false));
      this.listen(b, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); this.set(true); } });
      this.listen(b, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') this.set(false); });
      this.listen(b, 'blur', () => this.set(false));
      this.listen(b, 'contextmenu', (e) => e.preventDefault());
    }
  }

  get isOn() { return this.on_; }

  set(on, { silent = false } = {}) {
    on = !!on;
    const changed = on !== this.on_;
    this.on_ = on;
    this.el.setAttribute('aria-pressed', on);
    this.el.textContent = on ? this.options.txLabel : this.options.label;
    if (changed && !silent) this.emit('ptt', { on });
  }
}
