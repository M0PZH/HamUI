// Spectrum (panadapter trace): level vs frequency, with averaging, peak hold,
// dB grid, frequency axis, passband, dial and markers.
import { Surface } from '../core/canvas.js';
import { niceStep, formatAxisHz } from '../core/format.js';
import { h } from '../core/dom.js';
import { ScopeBase } from './scope-base.js';
import { haptics } from '../core/haptics.js';
import { normalizePlan, txFor, formatSymbolRate } from './channels.js';

const AXIS_H = 22;   // css px
const REGION_H = 18;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const DEFAULTS = {
  minDb: -130,
  maxDb: -50,
  averaging: 0.35,     // 0..1 weight of each new frame (1 = no averaging)
  peakHold: true,
  peakDecay: 0.15,     // dB per update
  fill: true,
  grid: true,
  dbStep: 10,          // dB between grid lines; doubled while lines would be closer than 16 px
  axis: true,          // frequency labels along the bottom
  dbLabels: true,
  channels: null,      // a channel plan for the strip under the trace (see channels.js)
  haptics: true,       // haptic 'select' when a channel is picked
};

export class Spectrum extends ScopeBase {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS, 'ham-spectrum');
    this.drawsLabels = true;
    this.data = null;
    this.avg = null;
    this.peak = null;
    this._col = new Float32Array(0);
    this._colPeak = new Float32Array(0);
    this.surface = new Surface(this.el, { onResize: () => this.invalidate() });
    this.el.prepend(this.surface.canvas);
    this._hoverCh = null;
    this._frame = 0;
    this._floorFrame = -1;
    this.setChannels(this.options.channels);
  }

  // ---- channel strip ----------------------------------------------------

  /** Set (or clear with null) the channel plan drawn under the trace. */
  setChannels(plan) {
    this.options.channels = plan;
    this.plan = normalizePlan(plan);
    const prev = this.channel;
    this.channel = prev && this.plan ? this._findChannel(prev.hz, prev.lane) : null;
    this._hoverCh = null;
    if (!this.plan) {
      this.tipEl?.remove(); this.tipEl = null;
      this.el.classList.remove('has-channels');
      this.el.style.removeProperty('--ham-channel-strip');
    } else {
      if (!this.tipEl) {
        this.tipEl = h('div', { class: 'ham-channel-tip', 'aria-hidden': 'true', hidden: true });
        this.el.appendChild(this.tipEl);
      }
      this.el.classList.add('has-channels');
      this.el.style.setProperty('--ham-channel-strip', `${this._strip().h}px`);
    }
    this.invalidate();
  }

  /** Strip geometry in CSS px. */
  _strip() {
    const p = this.plan;
    if (!p) return null;
    const laneH = p.laneHeight ?? (coarse() ? 18 : 14);
    const lanes = Math.max(1, p.lanes.length);
    const regionH = p.regions.length ? REGION_H : 0;
    return { laneH, lanes, lanesH: lanes * laneH, regionH, h: 4 + lanes * laneH + regionH + 2 };
  }

  onViewChange() {
    if (this._hoverCh) { this._hoverCh = null; this._showTip(null); }
    super.onViewChange();
  }

  _axisH() { return this.options.axis ? AXIS_H : 0; }

  /** y (CSS px from the top) where the strip starts; the trace ends there. */
  _stripTop(height) { return height - this._axisH() - (this._strip()?.h ?? 0); }

  _inStrip(clientY) {
    if (!this.plan) return false;
    const r = this.el.getBoundingClientRect();
    const y = clientY - r.top, top = this._stripTop(r.height);
    return y >= top && y < r.height - this._axisH();
  }

  /** The channel under a point, or null. */
  channelAt(clientX, clientY) {
    const p = this.plan, g = this._strip();
    if (!p) return null;
    const r = this.el.getBoundingClientRect();
    const y = clientY - r.top - this._stripTop(r.height) - 4;
    if (y < 0 || y >= g.lanesH) return null;
    const hz = this.clientXToHz(clientX);
    // fixed channels: at least a 12 px target (20 px on touch), nearest centre wins
    const hzPx = this.view.span / (r.width || 1), half = (coarse() ? 10 : 6) * hzPx;
    let fx = null, fd = Infinity;
    for (const f of p.fixed) {
      const d = Math.abs(hz - f.hz);
      if (d <= Math.max(f.width / 2, half) && d < fd) { fd = d; fx = f; }
    }
    if (fx) return fx;
    const lane = p.lanes[Math.floor(y / g.laneH)];
    if (!lane) return null;
    const slop = ((coarse() ? 12 : 3) * this.view.span) / (r.width || 1);
    let best = null, bd = Infinity;
    for (const ch of lane.channels) {
      const d = Math.abs(ch.hz - hz) - ch.width / 2;
      if (d < bd) { bd = d; best = ch; }
    }
    return bd <= slop ? best : null;
  }

  /** The channel containing hz, nearest centre first; `sr` prefers the lane with the closest symbol rate. */
  _findChannel(hz, lane, sr) {
    const all = this.plan?.all || [];
    const pool = lane === undefined ? all : all.filter((c) => c.lane === lane);
    const srCost = (c) => (sr && c.sr ? Math.abs(Math.log(c.sr / sr)) : 0);
    let best = null, bc = null;
    for (const ch of pool) {
      const d = Math.abs(ch.hz - hz);
      if (d > ch.width / 2) continue;
      const cost = [srCost(ch), d / ch.width];
      if (!bc || cost[0] < bc[0] - 1e-9 || (Math.abs(cost[0] - bc[0]) < 1e-9 && cost[1] < bc[1])) { best = ch; bc = cost; }
    }
    return best;
  }

  /**
   * Highlight the channel containing hz without tuning or emitting. Narrow it
   * with `lane` (an index, or null for fixed channels) or `sr` (closest symbol
   * rate wins). Returns the channel, or null.
   */
  selectChannel(hz, { lane, sr } = {}) {
    const ch = hz == null ? null : this._findChannel(hz, lane, sr);
    this.setChannel(ch);
    return ch;
  }

  clearChannel() { this.setChannel(null); }

  /** User pick: emits a cancelable ham:channel, then selects and tunes. */
  pickChannel(ch, source = 'click') {
    if (!ch || !this.plan) return;
    const txHz = this.plan.select === 'rx' ? null : txFor(this.plan, ch);
    const detail = {
      hz: ch.hz, rxHz: ch.hz, txHz, sr: ch.sr, width: ch.width, label: ch.label,
      lane: ch.lane, rxOnly: ch.rxOnly, channel: ch, source,
    };
    const ok = this.el.dispatchEvent(new CustomEvent('ham:channel', { detail, bubbles: true, cancelable: true }));
    if (!ok) return;
    if (this.options.haptics) haptics.fire('select', { source: this });
    this.setChannel(ch);
    this.tuneTo(ch.hz, { source: 'channel' });
  }

  _tap(e) {
    if (this._inStrip(e.clientY)) { this.pickChannel(this.channelAt(e.clientX, e.clientY)); return; }
    super._tap(e);
  }

  // the strip pans like the frequency axis, in every dragTune mode
  _grabTune(clientX, clientY) { return this._inStrip(clientY) ? null : super._grabTune(clientX, clientY); }

  _hover(clientX, clientY) {
    const ch = clientX == null || this.el.classList.contains('is-dragging') ? null : this.channelAt(clientX, clientY);
    if (ch !== this._hoverCh) { this._hoverCh = ch; this._showTip(ch); }
    this.el.classList.toggle('is-over-channel', !!ch);
    super._hover(clientX, clientY);
  }

  _showTip(ch) {
    const tip = this.tipEl;
    if (!tip) return;
    if (!ch) { tip.hidden = true; return; }
    const dec = ch.width >= 50e3 ? 3 : 6;
    const mhz = (hz) => (hz / 1e6).toFixed(dec);
    const tx = txFor(this.plan, ch);
    const occ = this._isBusy(ch);
    const line = (cls, ...parts) => h('div', { class: cls }, parts);
    tip.replaceChildren(...[
      ch.fixed && ch.label ? line('ham-channel-tip-label', ch.label) : null,
      line('', h('b', { text: `↓ ${mhz(ch.hz)}` }), ' MHz'),
      ch.rxOnly ? line('ham-channel-tip-muted', 'Receive only')
        : tx != null ? line('', h('b', { text: `↑ ${mhz(tx)}` }), ' MHz') : null,
      line('ham-channel-tip-muted', ...[ch.sr ? `${formatSymbolRate(ch.sr)}/s` : null,
        occ == null ? null : h('span', { class: occ ? 'is-busy' : '', text: occ ? 'occupied' : 'free' })]
        .filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))),
    ].filter(Boolean));
    const r = this.el.getBoundingClientRect();
    const x = this.view.frac(ch.hz) * r.width;
    tip.style.left = `${Math.max(70, Math.min(r.width - 70, x))}px`;
    tip.style.top = `${this._stripTop(r.height) + 4 + (ch.fixed ? 0 : ch.lane * this._strip().laneH)}px`;
    tip.hidden = false;
  }

  /** Occupancy of a channel: true/false, or null when not tracked. */
  _isBusy(ch) {
    const occ = this.plan?.occupancy;
    if (!occ) return null;
    if (typeof occ === 'function') return !!occ(ch);
    const src = this.avg;
    if (!src) return null;
    const n = src.length;
    if (this._floorFrame !== this._frame) {
      // noise floor: 20th percentile of the frame
      const sorted = Float32Array.from(src).sort();
      this._floor = sorted[Math.floor(n * 0.2)];
      this._floorFrame = this._frame;
    }
    const i0 = Math.max(0, Math.floor(((ch.hz - ch.width * 0.3 - this.dataStart) / this.dataSpan) * n));
    const i1 = Math.min(n, Math.ceil(((ch.hz + ch.width * 0.3 - this.dataStart) / this.dataSpan) * n));
    if (i1 <= i0) return null;
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += src[i];
    return sum / (i1 - i0) > this._floor + this.plan.occupancyDb;
  }

  _key(e) {
    const p = this.plan;
    if (p && !e.altKey && !e.ctrlKey && !e.metaKey && ['[', ']', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const cur = this.channel;
      const ref = cur?.hz ?? this.dial ?? this.view.center;
      let lane = cur ? cur.lane : (p.lanes.length ? 0 : null);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const order = [...(p.fixed.length ? [null] : []), ...p.lanes.map((_, i) => i)];
        const i = order.indexOf(lane);
        lane = order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      }
      const pool = (lane == null ? p.fixed : p.lanes[lane].channels).slice().sort((a, b) => a.hz - b.hz);
      if (!pool.length) return;
      let next;
      if (e.key === '[' || e.key === ']') {
        const dir = e.key === ']' ? 1 : -1;
        next = cur && cur.lane === lane
          ? pool[Math.max(0, Math.min(pool.length - 1, pool.indexOf(cur) + dir))]
          : pool.reduce((a, b) => (Math.abs(b.hz - ref) < Math.abs(a.hz - ref) ? b : a));
      } else {
        next = pool.reduce((a, b) => (Math.abs(b.hz - ref) < Math.abs(a.hz - ref) ? b : a));
      }
      if (next && next !== cur) {
        this.pickChannel(next, 'key');
        if (next.hz < this.view.start || next.hz > this.view.end) this.view.pan(next.hz - this.view.center);
      }
      return;
    }
    super._key(e);
  }

  refreshColors() {
    super.refreshColors();
    const f = getComputedStyle(this.el).getPropertyValue('--ham-font-ui').trim();
    this.fontUi = f || 'system-ui, sans-serif';
  }

  /**
   * Feed one frame of levels in dB(m). `bins` spans the data range
   * (startHz .. startHz + spanHz). Pass `range` to change it.
   * @param {ArrayLike<number>} bins
   * @param {{startHz:number, spanHz:number}} [range]
   */
  update(bins, range) {
    if (range) this.setDataRange(range.startHz, range.spanHz);
    const n = bins.length;
    if (!this.data || this.data.length !== n) {
      this.data = new Float32Array(n);
      this.avg = Float32Array.from(bins);
      this.peak = Float32Array.from(bins);
    }
    const a = this.options.averaging;
    const decay = this.options.peakDecay;
    for (let i = 0; i < n; i++) {
      const v = bins[i];
      this.data[i] = v;
      this.avg[i] += (v - this.avg[i]) * a;
      const p = this.peak[i] - decay;
      this.peak[i] = v > p ? v : p;
    }
    this._frame = (this._frame || 0) + 1;
    this.invalidate();
  }

  onDataRangeChange() { this.data = null; }

  /** Set the vertical scale in dB. */
  setLevels(minDb, maxDb) { this.options.minDb = minDb; this.options.maxDb = maxDb; this.invalidate(); }
  setAveraging(a) { this.options.averaging = a; }
  setPeakHold(on) { this.options.peakHold = on; if (on && this.data) this.peak.set(this.data); this.invalidate(); }
  clearPeak() { if (this.data) this.peak.set(this.data); this.invalidate(); }

  /** The frequency axis along the bottom is where a drag pans in 'press' mode. */
  isPanZone(clientX, clientY) {
    if (this._inStrip(clientY)) return true;
    if (!this.options.axis) return false;
    const r = this.el.getBoundingClientRect();
    return clientY - r.top > r.height - AXIS_H;
  }

  readoutText(hz, y) {
    const H = this._stripTop(this.el.clientHeight);
    const { minDb, maxDb } = this.options;
    const db = maxDb - (y / H) * (maxDb - minDb);
    const f = (hz / 1e6).toFixed(5);
    return y >= 0 && y <= H ? `${f} MHz · ${db.toFixed(0)} dB` : `${f} MHz`;
  }

  draw() {
    const s = this.surface;
    const ctx = s.ctx, W = s.width, Htot = s.height, dpr = s.dpr;
    if (!W || !Htot) return;
    const o = this.options, c = this.colors;
    const axisH = o.axis ? Math.round(AXIS_H * dpr) : 0;
    const strip = this._strip();
    const stripH = strip ? Math.round(strip.h * dpr) : 0;
    const H = Htot - axisH - stripH;
    const toY = (db) => (1 - (db - o.minDb) / (o.maxDb - o.minDb)) * H;
    // widen the dB step until lines are at least ~16 px apart (short spectra)
    let dbStep = o.dbStep;
    const pxPerDb = H / dpr / (o.maxDb - o.minDb || 1);
    while (dbStep * pxPerDb < 16 && dbStep < 1000) dbStep *= 2;

    ctx.fillStyle = c.inset;
    ctx.fillRect(0, 0, W, Htot);

    // grid
    const fstep = niceStep(this.view.span, W / dpr);
    if (o.grid) {
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let db = Math.ceil(o.minDb / dbStep) * dbStep; db <= o.maxDb; db += dbStep) {
        const y = Math.round(toY(db)) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      for (let f = Math.ceil(this.view.start / fstep) * fstep; f <= this.view.end; f += fstep) {
        const x = Math.round(this.xOf(f, W)) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    this.drawOverlayUnder(ctx, W, H, dpr);

    // trace
    if (this.data) {
      if (this._col.length !== W) { this._col = new Float32Array(W); this._colPeak = new Float32Array(W); }
      const src = o.averaging < 1 ? this.avg : this.data;
      const col = this.resample(src, 0, src.length, this._col, W);
      if (o.fill) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x < W; x++) ctx.lineTo(x, toY(col[x]));
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = c['trace-fill'];
        ctx.fill();
      }
      ctx.beginPath();
      for (let x = 0; x < W; x++) { const y = toY(col[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = c.trace;
      ctx.lineWidth = 1.25 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();

      if (o.peakHold) {
        const pk = this.resample(this.peak, 0, this.peak.length, this._colPeak, W);
        ctx.beginPath();
        for (let x = 0; x < W; x++) { const y = toY(pk[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.strokeStyle = c.peak;
        ctx.lineWidth = dpr;
        ctx.stroke();
      }
    }
    this.drawOverlayOver(ctx, W, H, dpr);
    ctx.restore();

    // dB labels
    ctx.font = `${10 * dpr}px ${this.font}`;
    if (o.dbLabels) {
      ctx.fillStyle = c['fg-faint'];
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      for (let db = Math.ceil(o.minDb / dbStep) * dbStep; db <= o.maxDb; db += dbStep) {
        const y = toY(db);
        if (y < 12 * dpr) continue;
        ctx.fillText(String(db), 6 * dpr, y - 2 * dpr);
      }
    }

    if (stripH) this._drawStrip(ctx, W, H, dpr, strip);

    // frequency axis
    if (axisH) {
      const ay = H + stripH;
      ctx.fillStyle = c.inset;
      ctx.fillRect(0, ay, W, axisH);
      ctx.fillStyle = c.border;
      ctx.fillRect(0, ay, W, Math.max(1, Math.round(dpr)));
      ctx.fillStyle = c['fg-faint'];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const margin = 30 * dpr;
      for (let f = Math.ceil(this.view.start / fstep) * fstep; f <= this.view.end; f += fstep) {
        const x = this.xOf(f, W);
        if (x < margin || x > W - margin) continue;
        ctx.fillText(formatAxisHz(f, fstep), x, ay + axisH / 2 + dpr);
      }
      ctx.textAlign = 'left';
    }
  }

  _drawStrip(ctx, W, top, dpr, g) {
    const p = this.plan, c = this.colors;
    const line = Math.max(1, Math.round(dpr));
    const laneH = g.laneH * dpr, y0 = top + 4 * dpr;
    ctx.fillStyle = c.inset;
    ctx.fillRect(0, top, W, g.h * dpr);
    ctx.fillStyle = c.border;
    ctx.fillRect(0, top, W, line);
    const sel = this.channel, hov = this._hoverCh;
    const selColor = this.transmitting ? c.tx : c.accent;

    const pill = (x0, x1, yc, hh, fill) => {
      const w = Math.max(2 * dpr, x1 - x0);
      ctx.fillStyle = fill;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, yc - hh / 2, w, hh, hh / 2); else ctx.rect(x0, yc - hh / 2, w, hh);
      ctx.fill();
    };

    // lanes
    p.lanes.forEach((lane, li) => {
      const yc = y0 + li * laneH + laneH / 2;
      for (const ch of lane.channels) {
        let x0 = this.xOf(ch.hz - ch.width / 2, W), x1 = this.xOf(ch.hz + ch.width / 2, W);
        if (x1 < 0 || x0 > W) continue;
        const gap = Math.min(3 * dpr, (x1 - x0) * 0.12);
        x0 += gap; x1 -= gap;
        let fill = this._isBusy(ch) ? c['channel-busy'] : c.channel, hh = 6 * dpr;
        if (ch === hov) { fill = c['accent-line']; hh = 8 * dpr; }
        if (ch === sel) { fill = selColor; hh = 8 * dpr; }
        pill(x0, x1, yc, hh, fill);
      }
    });

    // fixed channels span every lane; narrow ones (a beacon on a wide span)
    // keep a minimum width, or draw as a pin, with the label beside them
    ctx.textBaseline = 'middle';
    const fixed = p.fixed.slice().sort((a, b) => a.hz - b.hz);
    const yy = y0 + 2 * dpr, hh = g.lanesH * dpr - 4 * dpr, minW = p.fixedMinPx * dpr;
    let labelEnd = -Infinity;
    fixed.forEach((ch, i) => {
      const cx = this.xOf(ch.hz, W);
      let x0 = this.xOf(ch.hz - ch.width / 2, W) + 2 * dpr, x1 = this.xOf(ch.hz + ch.width / 2, W) - 2 * dpr;
      const narrow = x1 - x0 < minW * 2.5;
      if (x1 - x0 < minW) { x0 = cx - minW / 2; x1 = cx + minW / 2; }
      if (x1 < 0 || x0 > W) return;
      const isSel = ch === sel, isHov = ch === hov;
      const stroke = isSel ? selColor : isHov ? c['accent-line'] : c['fg-faint'];
      ctx.lineWidth = line;
      ctx.strokeStyle = stroke;
      const pin = narrow && p.fixedStyle === 'pin';
      if (pin) {
        const r = 4 * dpr, xs = Math.round(cx) + 0.5;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(xs, yy + 2 * r); ctx.lineTo(xs, yy + hh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + r, yy + r); ctx.lineTo(cx, yy + 2 * r); ctx.lineTo(cx - r, yy + r); ctx.closePath();
        ctx.fillStyle = isSel ? selColor : ch.rxOnly ? c.inset : isHov ? c['accent-line'] : c['fg-muted'];
        ctx.fill(); ctx.strokeStyle = isSel ? selColor : isHov ? c['accent-line'] : c['fg-muted']; ctx.stroke();
        x0 = cx - r; x1 = cx + r;
      } else {
        ctx.setLineDash(ch.rxOnly && !isSel ? [4 * dpr, 3 * dpr] : []);
        const rad = narrow ? 2 * dpr : Math.min(4 * dpr, (x1 - x0) / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0 + 0.5, yy + 0.5, x1 - x0 - 1, hh - 1, rad); else ctx.rect(x0 + 0.5, yy + 0.5, x1 - x0 - 1, hh - 1);
        if (isSel) { ctx.fillStyle = c.passband; ctx.fill(); }
        else if (narrow) { ctx.fillStyle = c.surface; ctx.fill(); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const text = [ch.label, ch.rxOnly ? 'RX only' : null].filter(Boolean).join(' · ');
      if (!text) return;
      ctx.fillStyle = isSel ? selColor : c['fg-muted'];
      if (!narrow) {
        ctx.font = `500 ${11 * dpr}px ${this.fontUi}`;
        ctx.textAlign = 'center';
        const fits = ctx.measureText(text).width < x1 - x0 - 10 * dpr;
        const t = fits ? text : ch.label && ctx.measureText(ch.label).width < x1 - x0 - 10 * dpr ? ch.label : '';
        if (t) ctx.fillText(t, (x0 + x1) / 2, yy + hh / 2);
        return;
      }
      // beside the mark, when it fits before the next fixed channel and after the last label
      if (!ch.label) return;
      ctx.font = `500 ${10 * dpr}px ${this.fontUi}`;
      ctx.textAlign = 'left';
      const next = fixed[i + 1] ? this.xOf(fixed[i + 1].hz, W) - minW : W;
      const lx = x1 + 4 * dpr, tw = ctx.measureText(ch.label).width;
      if (x0 > labelEnd && lx + tw < next) {
        ctx.fillText(ch.label, lx, pin ? yy + 4 * dpr : yy + hh / 2);
        labelEnd = lx + tw + 4 * dpr;
      } else labelEnd = Math.max(labelEnd, x1);
    });
    ctx.textAlign = 'center';

    // regions: separators and labels under the lanes
    if (g.regionH) {
      const ry = y0 + g.lanesH * dpr, sepH = g.lanesH * dpr + g.regionH * dpr;
      ctx.font = `500 ${10 * dpr}px ${this.fontUi}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.6 * dpr}px`;
      p.regions.forEach((r, i) => {
        const x0 = this.xOf(r.from, W), x1 = this.xOf(r.to, W);
        if (i) { ctx.fillStyle = c.border; ctx.fillRect(Math.round(x0), y0, line, sepH); }
        const v0 = Math.max(0, x0), v1 = Math.min(W, x1);
        const label = r.label.toUpperCase();
        const tw = ctx.measureText(label).width;
        if (v1 - v0 < tw + 12 * dpr) return;
        ctx.fillStyle = c['fg-faint'];
        ctx.fillText(label, (v0 + v1) / 2, ry + (g.regionH * dpr) / 2 + dpr);
      });
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
    ctx.textAlign = 'left';
  }

  // passband goes under the trace; lines over it
  drawOverlayUnder(ctx, W, H) {
    if (this.channel) {
      const x0 = this.xOf(this.channel.hz - this.channel.width / 2, W);
      const x1 = this.xOf(this.channel.hz + this.channel.width / 2, W);
      ctx.fillStyle = this.transmitting ? this.colors.tx : this.colors.passband;
      ctx.globalAlpha = this.transmitting ? 0.14 : 1;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.globalAlpha = 1;
    }
    if (this.dial != null && this.passband) {
      const x0 = this.xOf(this.dial + this.passband[0], W);
      const x1 = this.xOf(this.dial + this.passband[1], W);
      ctx.fillStyle = this.colors.passband;
      ctx.fillRect(x0, 0, x1 - x0, H);
    }
  }

  drawOverlayOver(ctx, W, H, dpr) {
    const pb = this.passband;
    this.passband = null; // already drawn underneath
    this.drawOverlay(ctx, W, H, dpr);
    this.passband = pb;
    if (this.channel) this._drawChannelTag(ctx, W, dpr);
  }

  /** "10494.750 · 333 kS" by the dial line of the selected channel. */
  _drawChannelTag(ctx, W, dpr) {
    const ch = this.channel, c = this.colors;
    const dec = ch.width >= 50e3 ? 3 : 6;
    const text = [ch.fixed && ch.label ? ch.label : (ch.hz / 1e6).toFixed(dec), ch.sr ? formatSymbolRate(ch.sr) : null]
      .filter(Boolean).join(' · ');
    ctx.font = `${11 * dpr}px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const tw = ctx.measureText(text).width + 12 * dpr, th = 20 * dpr;
    const x = this.xOf(ch.hz, W);
    if (x < 0 || x > W) return;
    const lx = Math.max(4 * dpr, Math.min(W - tw - 4 * dpr, x + 6 * dpr)), ly = 8 * dpr;
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = this.transmitting ? c.tx : c['accent-line'];
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx + 0.5, ly + 0.5, tw, th, 4 * dpr); else ctx.rect(lx + 0.5, ly + 0.5, tw, th);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.fg;
    ctx.fillText(text, lx + 6 * dpr, ly + th / 2 + dpr);
  }

  destroy() {
    this.surface.destroy();
    super.destroy();
  }
}
