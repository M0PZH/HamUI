// VideoPanel: a canvas for decoded video with overlays (title, a centred
// message, stats, a "Turn sound on" chip) and a control bar (mute, volume,
// level meter, running time, Stats, full screen). It never decodes: the app
// draws into `canvas` (WebCodecs, WebGL, ...) and calls the setters.
//
//   const vp = new HamUI.VideoPanel('#video', { label: 'DATV video' });
//   decoder.attach(vp.canvas);
//   vp.setTitle('N0CALL', 'H.265 · 1280×720 · 25 fps');
//   vp.setMessage('Waiting for a key frame');         // null hides it
//   vp.setStats([['Video', '312 kbit/s'], ['Frames dropped', 3, 'warn']]);
//   vp.on('volume', (e) => (gain.value = e.detail.gain));
import { Component, h } from '../core/dom.js';

const ICON = {
  sound: '<path d="M2 6h3l4-3v10L5 10H2z"/><path class="ham-video-wave" d="M11 5.5a3.5 3.5 0 010 5M12.8 3.8a6 6 0 010 8.4"/>',
  muted: '<path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11.5 5.5l3 5m0-5l-3 5"/>',
  fullscreen: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  exit: '<path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/>',
};
const svg = (name) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const DEFAULTS = {
  label: 'Video',
  aspect: '16 / 9',     // stage aspect ratio, or 'fill' to fill a sized parent (flex column)
  audio: true,          // mute button, volume slider and level meter
  volume: 1,            // 0..1
  muted: false,
  stats: true,          // Stats toggle button
  fullscreen: true,     // full screen button, double-click, F key
  width: 640,           // initial canvas backing size; the app resizes it to the video
  height: 360,
};

export class VideoPanel extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.el.classList.add('ham-video');
    this.el.classList.toggle('is-fill', o.aspect === 'fill');
    if (o.aspect !== 'fill') this.el.style.setProperty('--ham-video-aspect', o.aspect);
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', o.label);
    if (!this.el.hasAttribute('tabindex')) this.el.tabIndex = -1;

    this.canvas = h('canvas', { class: 'ham-video-canvas', 'aria-label': o.label });
    this.canvas.width = o.width;
    this.canvas.height = o.height;
    this.titleMain = h('b');
    this.titleSub = h('span');
    this.titleEl = h('div', { class: 'ham-video-title', hidden: true }, [this.titleMain, this.titleSub]);
    this.msgEl = h('div', { class: 'ham-video-msg', role: 'status', hidden: true });
    this.statsEl = h('dl', { class: 'ham-video-stats', hidden: true });
    this.soundEl = h('button', { type: 'button', class: 'ham-video-sound', hidden: true });
    this.soundEl.innerHTML = `${svg('muted')}<span>Turn sound on</span>`;
    this.stage = h('div', { class: 'ham-video-stage' }, [this.canvas, this.titleEl, this.msgEl, this.statsEl, this.soundEl]);

    this.barLeft = h('div', { class: 'ham-video-bar-group' });
    this.barRight = h('div', { class: 'ham-video-bar-group' });
    this.timeEl = h('span', { class: 'ham-video-time', hidden: true });
    this.bar = h('div', { class: 'ham-video-bar' }, [this.barLeft, h('span', { class: 'ham-spacer' }), this.timeEl, this.barRight]);
    this.el.append(this.stage, this.bar);

    this._statCells = new Map();
    this._pending = null;
    this._volume = Math.max(0, Math.min(1, o.volume));
    this._muted = !!o.muted || this._volume === 0;
    if (this._volume === 0) this._volume = 1;

    if (o.audio) {
      this.muteBtn = this.addButton({ label: '', side: 'left', icon: true, onclick: () => this.setMuted(!this._muted, { user: true }) });
      this.volEl = h('input', { type: 'range', class: 'ham-range ham-video-volume', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
      this.listen(this.volEl, 'input', () => this._onSlider());
      this.levelBar = h('i');
      this.levelEl = h('div', { class: 'ham-video-level', 'aria-hidden': 'true' }, [this.levelBar]);
      this.addControl(h('div', { class: 'ham-video-vol' }, [this.volEl, this.levelEl]));
    }
    if (o.stats) {
      this.statsBtn = this.addButton({ label: 'Stats', title: 'Show playback statistics', side: 'right', onclick: () => this.showStats(this.statsEl.hidden, { user: true }) });
      this.statsBtn.setAttribute('aria-pressed', 'false');
    }
    if (o.fullscreen && (this.el.requestFullscreen || this.el.webkitRequestFullscreen)) {
      this.fsBtn = this.addButton({ label: '', side: 'right', icon: true, onclick: () => this.toggleFullscreen() });
      this.listen(this.stage, 'dblclick', (e) => { if (!e.target.closest('button')) this.toggleFullscreen(); });
      const onFs = () => this._syncFullscreen();
      this.listen(document, 'fullscreenchange', onFs);
      this.listen(document, 'webkitfullscreenchange', onFs);
      this._syncFullscreen();
    }
    this.listen(this.soundEl, 'click', () => {
      this.emit('unmute', {});
      if (this._muted) this.setMuted(false, { user: true });
    });
    this.listen(this.el, 'keydown', (e) => this._key(e));
    this._renderVolume();
  }

  /** Add a small button to the control bar; returns it. `icon: true` makes it square. */
  addButton({ label, title, onclick, side = 'left', cls = '', icon = false }) {
    const b = h('button', { type: 'button', class: `ham-btn ham-btn-sm ham-btn-ghost${icon ? ' ham-btn-icon' : ''} ${cls}`.trim() }, label ? [label] : []);
    if (title) b.title = title;
    if (onclick) b.addEventListener('click', onclick);
    (side === 'right' ? this.barRight : this.barLeft).append(b);
    return b;
  }

  /** Add any element to the control bar. */
  addControl(node, side = 'left') { (side === 'right' ? this.barRight : this.barLeft).append(node); return node; }

  setTitle(main, sub = '') {
    if (this.titleMain.textContent !== (main || '')) this.titleMain.textContent = main || '';
    if (this.titleSub.textContent !== (sub || '')) this.titleSub.textContent = sub || '';
    this.titleEl.hidden = !main && !sub;
  }

  /** Centred message over the picture; tone '' | 'warn' | 'error'; null hides it. */
  setMessage(text, tone = '') {
    this.msgEl.hidden = !text;
    if (text && this.msgEl.textContent !== text) this.msgEl.textContent = text;
    this.msgEl.dataset.tone = tone || '';
  }

  /** Stats rows: [[label, value, tone?], ...]. Kept while hidden, shown on open. */
  setStats(rows) {
    if (this.statsEl.hidden) { this._pending = rows; return; }
    this._pending = null;
    const seen = new Set();
    for (const [label, value, tone] of rows) {
      seen.add(label);
      let c = this._statCells.get(label);
      if (!c) {
        c = { dt: h('dt', { text: label }), dd: h('dd') };
        this.statsEl.append(c.dt, c.dd);
        this._statCells.set(label, c);
      }
      const t = value == null ? '—' : String(value);
      if (c.dd.textContent !== t) c.dd.textContent = t;
      c.dd.dataset.tone = tone || '';
    }
    for (const [label, c] of this._statCells) {
      if (!seen.has(label)) { c.dt.remove(); c.dd.remove(); this._statCells.delete(label); }
    }
  }

  showStats(on, { user = false } = {}) {
    this.statsEl.hidden = !on;
    this.statsBtn?.setAttribute('aria-pressed', String(!!on));
    if (on && this._pending) this.setStats(this._pending);
    if (user) this.emit('stats', { on: !!on });
  }

  /** Show the "Turn sound on" chip (the browser is holding audio back until a click). */
  setSoundBlocked(on) { this.soundEl.hidden = !on; }

  /** Volume 0..1 (the level kept while muted). */
  get volume() { return this._volume; }
  get muted() { return this._muted; }
  /** What to apply to the audio: 0 when muted. */
  get gain() { return this._muted ? 0 : this._volume; }

  setVolume(v, { silent = false } = {}) {
    v = Math.max(0, Math.min(1, +v || 0));
    if (v === 0) { this._muted = true; } else { this._volume = v; this._muted = false; }
    this._renderVolume();
    if (!silent) this._emitVolume();
  }

  setMuted(m, { silent = false, user = false } = {}) {
    this._muted = !!m;
    this._renderVolume();
    if (!silent || user) this._emitVolume();
  }

  _onSlider() {
    const v = +this.volEl.value / 100;
    if (v === 0) this._muted = true;
    else { this._volume = v; this._muted = false; }
    this._renderVolume();
    this._emitVolume();
  }

  _emitVolume() { this.emit('volume', { volume: this._volume, muted: this._muted, gain: this.gain }); }

  // muted shows the slider at 0; the volume comes back on unmute
  _renderVolume() {
    if (!this.volEl) return;
    const p = Math.round(this.gain * 100);
    if (+this.volEl.value !== p) this.volEl.value = p;
    this.volEl.style.setProperty('--ham-range-p', `${p}%`);
    this.muteBtn.innerHTML = svg(this._muted ? 'muted' : 'sound');
    this.muteBtn.setAttribute('aria-label', this._muted ? 'Unmute' : 'Mute');
    this.muteBtn.setAttribute('aria-pressed', String(this._muted));
    if (this._muted) this.setLevel(0);
  }

  /** Audio level meter, 0..1. */
  setLevel(v) {
    if (!this.levelBar) return;
    const w = `${Math.round(Math.max(0, Math.min(1, this._muted ? 0 : v)) * 100)}%`;
    if (this.levelBar.style.width !== w) this.levelBar.style.width = w;
  }

  /** Running time in seconds; null hides it. */
  setTime(sec) {
    this.timeEl.hidden = sec == null;
    if (sec == null) return;
    const s = Math.max(0, Math.floor(sec));
    const t = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (this.timeEl.textContent !== t) this.timeEl.textContent = t;
  }

  get isFullscreen() {
    const d = document;
    return (d.fullscreenElement || d.webkitFullscreenElement) === this.el;
  }

  toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else {
      const r = (this.el.requestFullscreen || this.el.webkitRequestFullscreen)?.call(this.el);
      r?.catch?.(() => {});
    }
  }

  _syncFullscreen() {
    if (!this.fsBtn) return;
    const on = this.isFullscreen;
    this.fsBtn.innerHTML = svg(on ? 'exit' : 'fullscreen');
    this.fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    if (this._fs !== undefined && this._fs !== on) this.emit('fullscreen', { on });
    this._fs = on;
  }

  _key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'm' && this.options.audio) { this.setMuted(!this._muted, { user: true }); e.preventDefault(); }
    else if (k === 'f' && this.fsBtn) { this.toggleFullscreen(); e.preventDefault(); }
  }

  destroy() {
    super.destroy();
    this.el.replaceChildren();
    this.el.classList.remove('ham-video', 'is-fill');
  }
}
