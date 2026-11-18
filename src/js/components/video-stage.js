// VideoStage: one or more 16:9 frames that fill the space they are given as
// large as they can, side by side or stacked, whichever gives the larger
// pictures. One frame is selected (it gets the sound and the controls in a
// theatre page). Put a VideoPanel (or anything) in `stage.frames[i]`.
//
//   const stage = new VideoStage(el, { count: 2 });
//   new VideoPanel(stage.frames[0], { aspect: 'fill' });
//   stage.on('select', (e) => setSlot(e.detail.index));
//   slotButton.onclick = () => stage.pick(1);   // select; again: close that picture
import { Component, h } from '../core/dom.js';

const DEFAULTS = {
  count: 2,             // frames
  visible: null,        // which are shown (default: all)
  selected: 0,
  aspect: 16 / 9,       // of the picture
  extra: 0,             // px under each picture (a VideoPanel's control bar: 44)
  gap: 8,               // px between frames
  selectOnClick: true,
  label: 'Video',
};

/**
 * Frame size for `n` frames, each a picture of `aspect` plus `extra` px
 * under it, in W × H: tries every grid (columns × rows) and keeps the one
 * with the largest pictures.
 */
export function fitFrames(W, H, n, aspect = 16 / 9, gap = 8, extra = 0) {
  let best = { cols: 1, rows: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    const w = Math.min(cw, (ch - extra) * aspect);
    if (w > best.w + 0.5) best = { cols, rows, w: Math.floor(w), h: Math.floor(w / aspect + extra) };
  }
  return best;
}

/**
 * What choosing frame `i` does (a slot switch): a hidden frame is shown and
 * selected; a shown, unselected one is selected; the selected one is closed
 * when another is still shown (which becomes selected), else nothing.
 */
export function pickFrame({ visible, selected }, i) {
  const vis = [...visible];
  if (!vis[i]) { vis[i] = true; return { visible: vis, selected: i }; }
  if (selected !== i) return { visible: vis, selected: i };
  const others = vis.map((v, k) => (v && k !== i ? k : -1)).filter((k) => k >= 0);
  if (!others.length) return { visible: vis, selected };
  vis[i] = false;
  return { visible: vis, selected: others[0] };
}

export class VideoStage extends Component {
  constructor(el, options = {}) {
    super(el, options, DEFAULTS);
    const o = this.options;
    this.el.classList.add('ham-vstage');
    this.frames = [];
    this.visible = Array.from({ length: o.count }, (_, i) => o.visible ? !!o.visible[i] : true);
    if (!this.visible.some(Boolean)) this.visible[0] = true;
    this.selected = this.visible[o.selected] ? o.selected : this.visible.indexOf(true);
    this.el.replaceChildren(...Array.from({ length: o.count }, (_, i) => {
      const f = h('div', { class: 'ham-vstage-frame', 'data-index': i, role: 'group', 'aria-label': `${o.label} ${i + 1}` });
      this.frames.push(f);
      return f;
    }));
    if (o.selectOnClick) {
      this.listen(this.el, 'pointerdown', (e) => {
        const f = e.target.closest('.ham-vstage-frame');
        if (f && this.el.contains(f)) this.select(+f.dataset.index, { source: 'user' });
      });
    }
    this._ro = new ResizeObserver(() => this.layout());
    this._ro.observe(this.el);
    this.onDestroy(() => this._ro.disconnect());
    this._render();
  }

  /** Number of frames shown. */
  get count() { return this.visible.filter(Boolean).length; }

  /** Select a shown frame. Emits ham:select {index, source}. */
  select(i, { source = 'api' } = {}) {
    if (!this.visible[i] || i === this.selected) return;
    this.selected = i;
    this._render();
    this.emit('select', { index: i, source });
  }

  /** Show or hide a frame (the last one shown stays). Emits ham:change {visible, selected}. */
  show(i, on = true, { source = 'api' } = {}) {
    const vis = [...this.visible];
    vis[i] = !!on;
    if (!vis.some(Boolean)) return;
    let sel = this.selected;
    if (!vis[sel]) sel = vis.indexOf(true);
    this._set(vis, sel, source);
  }

  /** A slot switch press: select it; when it is already selected, close it (see pickFrame). */
  pick(i, { source = 'user' } = {}) {
    const r = pickFrame({ visible: this.visible, selected: this.selected }, i);
    this._set(r.visible, r.selected, source);
  }

  _set(vis, sel, source) {
    const changed = vis.some((v, k) => v !== this.visible[k]);
    const selChanged = sel !== this.selected;
    this.visible = vis;
    this.selected = sel;
    this._render();
    if (selChanged) this.emit('select', { index: sel, source });
    if (changed || selChanged) this.emit('change', { visible: [...vis], selected: sel, source });
  }

  _render() {
    this.frames.forEach((f, i) => {
      f.hidden = !this.visible[i];
      f.classList.toggle('is-selected', i === this.selected && this.count > 1);
      f.setAttribute('aria-current', String(i === this.selected));
    });
    this.el.dataset.count = this.count;
    this.layout();
  }

  /** Recompute the frame size (also runs on resize). */
  layout() {
    const o = this.options;
    const cs = getComputedStyle(this.el);
    const W = this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = this.el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fit = fitFrames(W, H, this.count, o.aspect, o.gap, o.extra);
    this.el.style.setProperty('--ham-vstage-cols', fit.cols);
    this.el.style.setProperty('--ham-vstage-w', `${fit.w}px`);
    this.el.style.setProperty('--ham-vstage-h', `${fit.h}px`);
    this.el.style.setProperty('--ham-vstage-gap', `${o.gap}px`);
    this.el.dataset.cols = fit.cols;
  }
}
