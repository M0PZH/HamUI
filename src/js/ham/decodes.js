// DecodeList: an FT8/FT4 receive log. Rows grouped by cycle, CQ and
// messages to your call highlighted, your own transmissions in red, a cycle
// progress bar, All / CQ / To me filters, and it follows the newest decodes
// until you scroll up.
//
//   const dl = new HamUI.DecodeList('#decodes', { mode: 'FT8', myCall: 'M0PZH' });
//   dl.push({ time: '210430', snr: -12, dt: 0.2, freq: 1234, message: 'CQ DX IZ1AAA JN45' });
//   dl.push({ time: '210445', tx: true, freq: 1500, message: 'IZ1AAA M0PZH IO91' });
//   dl.on('select', (e) => reply(e.detail));
import { Component, h } from '../core/dom.js';
import { Segmented } from '../components/segmented.js';

const PERIOD = { FT8: 15, FT4: 7.5 };
const GRID = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i;
const REPORT = /^(R)?([+-]\d{1,2})$/;
const ACK = new Set(['RRR', 'RR73', '73']);
const isCall = (t) => /^<.+>$/.test(t) || (/\d/.test(t) && /[A-Z]/.test(t) && /^[A-Z0-9/]{3,}$/.test(t) && !GRID.test(t) && !REPORT.test(t) && !ACK.has(t));
const baseCall = (c) => (c || '').replace(/[<>]/g, '').split('/').reduce((a, b) => (b.length > a.length ? b : a), '');

/**
 * Parse a standard FT8/FT4 message.
 * @returns {{cq:boolean, tag:string|null, to:string|null, from:string|null, grid:string|null,
 *   report:number|null, roger:boolean, ack:string|null, free:boolean}}
 */
export function parseFt8(message) {
  const t = String(message || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const r = { cq: false, tag: null, to: null, from: null, grid: null, report: null, roger: false, ack: null, free: false };
  let i = 0;
  if (t[0] === 'CQ' || t[0] === 'QRZ') {
    r.cq = t[0] === 'CQ';
    i = 1;
    if (t[i] && !isCall(t[i]) && t[i + 1] && isCall(t[i + 1])) r.tag = t[i++];
    r.from = isCall(t[i] || '') ? t[i++] : null;
  } else if (t.length >= 2 && isCall(t[0]) && isCall(t[1])) {
    r.to = t[0]; r.from = t[1]; i = 2;
  } else {
    r.free = true;
    return r;
  }
  const x = t[i];
  if (x) {
    const m = REPORT.exec(x);
    if (x === 'RR73' || x === 'RRR' || x === '73') { r.ack = x; r.roger = x !== '73'; }
    else if (m) { r.report = +m[2]; r.roger = !!m[1]; }
    else if (GRID.test(x)) r.grid = x;
    else if (x === 'R' && t[i + 1] && GRID.test(t[i + 1])) { r.roger = true; r.grid = t[i + 1]; }
  }
  if (!r.from) r.free = true;
  return r;
}

const DEFAULTS = {
  mode: 'FT8',          // 'FT8' | 'FT4': sets the cycle length
  title: null,          // header title (default: the mode)
  subtitle: '',         // e.g. '14.074 MHz'
  myCall: '',           // highlights messages to this call
  max: 500,             // rows kept
  filter: 'all',        // 'all' | 'cq' | 'me'
  filters: true,        // show the All / CQ / To me control
  cycle: 'auto',        // 'auto' (from the clock) | false; or drive it with setCycle()
  txPeriod: null,       // 'even' | 'odd': which cycles are yours, for the TX colour of the bar
  info: 'auto',         // Info column: 'auto' (when any decode has info) | true | false
};

export class DecodeList extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.el.classList.add('ham-decodes');
    this.decodes = [];
    this.selected = null;
    this.newCount = 0;

    this.titleEl = h('span', { class: 'ham-decodes-title' });
    this.subEl = h('span', { class: 'ham-decodes-sub' });
    const head = h('div', { class: 'ham-decodes-head' }, [this.titleEl, this.subEl, h('span', { class: 'ham-spacer' })]);
    if (o.filters) {
      const segEl = h('div', { class: 'ham-seg ham-seg-sm', 'aria-label': 'Show' });
      head.append(segEl);
      this.filterSeg = new Segmented(segEl, { items: [{ value: 'all', label: 'All' }, { value: 'cq', label: 'CQ' }, { value: 'me', label: 'To me' }], value: o.filter });
      this.listen(segEl, 'ham:change', (e) => { e.stopPropagation(); this.setFilter(e.detail.value); });
    }
    this.cycleBar = h('i');
    this.cycleEl = h('div', { class: 'ham-decodes-cycle', 'aria-hidden': 'true' }, [this.cycleBar]);
    this.tbody = h('tbody');
    this.infoTh = h('th', { class: 'ham-decodes-info', text: 'Info' });
    const thead = h('thead', {}, [h('tr', {}, [
      h('th', { text: 'UTC' }), h('th', { text: 'dB' }), h('th', { class: 'ham-decodes-dt', text: 'DT' }), h('th', { text: 'Hz' }),
      h('th', { class: 'ham-decodes-msg', text: 'Message' }), this.infoTh,
    ])]);
    this.table = h('table', {}, [thead, this.tbody]);
    this.jumpBtn = h('button', { type: 'button', class: 'ham-btn ham-btn-sm ham-decodes-jump', hidden: true });
    this.body = h('div', { class: 'ham-decodes-body', tabindex: 0, role: 'log', 'aria-label': 'Decodes' }, [this.table, this.jumpBtn]);
    this.el.append(head, this.cycleEl, this.body);

    this.listen(this.body, 'scroll', () => { if (this._atEnd()) this._clearNew(); });
    this.listen(this.jumpBtn, 'click', () => this.scrollToEnd());
    this.listen(this.tbody, 'click', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (tr) this.select(this._byIndex(+tr.dataset.i));
    });
    this.listen(this.body, 'keydown', (e) => this._key(e));

    this.setMode(o.mode);
    this._render();
    this._tick = this._tick.bind(this);
    if (o.cycle === 'auto') this._timer = setInterval(this._tick, 250);
    this._tick();
  }

  setMode(mode) {
    this.options.mode = PERIOD[mode] ? mode : 'FT8';
    this.titleEl.textContent = this.options.title || this.options.mode;
    this.setSubtitle(this.options.subtitle);
    this._tick?.();
  }

  setSubtitle(text) {
    this.options.subtitle = text || '';
    const p = PERIOD[this.options.mode];
    this.subEl.textContent = [text, `${p} s`].filter(Boolean).join(' · ');
  }

  setMyCall(call) { this.options.myCall = call || ''; this.decodes.forEach((d) => this._classify(d)); this._render(); }

  setFilter(f) {
    this.options.filter = ['cq', 'me'].includes(f) ? f : 'all';
    if (this.filterSeg && this.filterSeg.value !== this.options.filter) this.filterSeg.select(this.options.filter, { silent: true });
    this._render();
    this.scrollToEnd();
  }

  /**
   * Add decodes (one or an array): {time, snr, dt, freq, message, info?, tx?}.
   * `time` is 'HHMMSS', a Date or epoch ms (UTC).
   */
  push(items) {
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return;
    const follow = this._atEnd();
    let shown = 0;
    for (const raw of list) {
      const d = { ...raw, time: fmtTime(raw.time), freq: raw.freq != null ? Math.round(raw.freq) : null, _i: (this._seq = (this._seq || 0) + 1) };
      this._classify(d);
      this.decodes.push(d);
      if (this._passes(d)) { this._appendRow(d); shown++; }
    }
    const over = this.decodes.length - this.options.max;
    if (over > Math.max(20, this.options.max * 0.1)) {
      this.decodes.splice(0, over);
      if (this.selected && !this.decodes.includes(this.selected)) this.selected = null;
      this._render();
    }
    this._updateInfo();
    if (follow) this.scrollToEnd();
    else if (shown) { this.newCount += shown; this.jumpBtn.textContent = `${this.newCount} new ↓`; this.jumpBtn.hidden = false; }
  }

  clear() { this.decodes = []; this.selected = null; this._render(); this._clearNew(); }

  /** Select a decode (or null); emits ham:select. */
  select(d, { silent = false } = {}) {
    this.selected = d || null;
    for (const tr of this.tbody.querySelectorAll('tr.is-selected')) tr.classList.remove('is-selected');
    if (d) {
      const tr = this.tbody.querySelector(`tr[data-i="${d._i}"]`);
      tr?.classList.add('is-selected');
      tr?.scrollIntoView({ block: 'nearest' });
    }
    if (!silent && d) this.emit('select', this._public(d));
  }

  /** Drive the cycle bar by hand: frac 0..1 of the current cycle. */
  setCycle(frac, { tx = false } = {}) {
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    this._setBar(frac, tx);
  }

  scrollToEnd() { this.body.scrollTop = this.body.scrollHeight; this._clearNew(); }

  // ---- internals ---------------------------------------------------------

  _tick() {
    if (this.options.cycle !== 'auto' || !this.cycleBar) return;
    const p = PERIOD[this.options.mode], s = Date.now() / 1000;
    const idx = Math.floor(s / p);
    const tp = this.options.txPeriod;
    const tx = tp ? (idx % 2 === 0) === (tp === 'even') : false;
    this._setBar((s % p) / p, tx);
  }

  _setBar(frac, tx) {
    const w = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
    if (this.cycleBar.style.width !== w) this.cycleBar.style.width = w;
    this.cycleEl.classList.toggle('is-tx', !!tx);
  }

  _classify(d) {
    const p = parseFt8(d.message);
    const me = baseCall(this.options.myCall).toUpperCase();
    d.parsed = p;
    d.cq = p.cq;
    d.toMe = !!me && !d.tx && baseCall(p.to).toUpperCase() === me;
  }

  _passes(d) {
    const f = this.options.filter;
    return f === 'all' || (f === 'cq' ? d.cq : d.toMe || d.tx);
  }

  _byIndex(i) { return this.decodes.find((d) => d._i === i) || null; }

  _public(d) {
    const { _i, parsed, ...rest } = d;
    return { ...rest, ...parsed, call: parsed.from };
  }

  _render() {
    this.tbody.replaceChildren();
    this._lastTime = null;
    this._lastCycleRow = null;
    for (const d of this.decodes) if (this._passes(d)) this._appendRow(d);
    this._updateInfo();
  }

  _appendRow(d) {
    if (d.time !== this._lastTime) {
      const label = h('span', { text: d.time ? `${d.time.slice(0, 2)}:${d.time.slice(2, 4)}:${d.time.slice(4, 6)}` : '' });
      this._lastCycleRow = h('tr', { class: 'ham-decodes-cycle-row' }, [h('td', { colspan: 6 }, [label])]);
      this.tbody.append(this._lastCycleRow);
      this._lastTime = d.time;
    }
    if (d.tx && this._lastCycleRow && !this._lastCycleRow.dataset.tx) {
      this._lastCycleRow.dataset.tx = '1';
      this._lastCycleRow.firstChild.firstChild.textContent += ' · TX';
    }
    const cls = ['ham-decodes-row', d.cq && 'is-cq', d.toMe && 'is-me', d.tx && 'is-tx', d === this.selected && 'is-selected'].filter(Boolean).join(' ');
    const snr = d.tx ? 'TX' : d.snr == null ? '' : `${d.snr > 0 ? '+' : ''}${d.snr}`;
    this.tbody.append(h('tr', { class: cls, 'data-i': d._i }, [
      h('td', { text: d.time || '' }),
      h('td', { class: !d.tx && d.snr != null && d.snr < -18 ? 'is-weak' : null, text: snr }),
      h('td', { class: 'ham-decodes-dt', text: d.dt == null || d.tx ? '' : Number(d.dt).toFixed(1) }),
      h('td', { text: d.freq ?? '' }),
      h('td', { class: 'ham-decodes-msg' }, this._msgNodes(d)),
      h('td', { class: 'ham-decodes-info', text: d.info || '' }),
    ]));
  }

  _msgNodes(d) {
    const me = baseCall(this.options.myCall).toUpperCase();
    const words = String(d.message || '').trim().split(/\s+/);
    const out = [];
    words.forEach((w, i) => {
      if (i) out.push(' ');
      if (i === 0 && w.toUpperCase() === 'CQ') out.push(h('span', { class: 'ham-decodes-cq', text: w }));
      else if (me && baseCall(w).toUpperCase() === me) out.push(h('span', { class: 'ham-decodes-me', text: w }));
      else out.push(w);
    });
    return out;
  }

  _updateInfo() {
    const o = this.options.info;
    const show = o === 'auto' ? this.decodes.some((d) => d.info) : !!o;
    this.el.classList.toggle('has-info', show);
  }

  _atEnd() { const b = this.body; return b.scrollTop + b.clientHeight >= b.scrollHeight - 4; }

  _clearNew() { this.newCount = 0; this.jumpBtn.hidden = true; }

  _key(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const rows = this.decodes.filter((d) => this._passes(d));
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(this.selected);
    const next = i < 0 ? rows[rows.length - 1] : rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next !== this.selected) this.select(next);
  }

  destroy() {
    clearInterval(this._timer);
    this.filterSeg?.destroy();
    super.destroy();
    this.el.replaceChildren();
    this.el.classList.remove('ham-decodes', 'has-info');
  }
}

function fmtTime(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t.replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  const d = t instanceof Date ? t : new Date(t);
  return d.toISOString().slice(11, 19).replace(/:/g, '');
}
