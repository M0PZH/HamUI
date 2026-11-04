// Spectrum + waterfall stacked, sharing one frequency view and dial.
import { Component, h } from '../core/dom.js';
import { Spectrum } from './spectrum.js';
import { Waterfall } from './waterfall.js';

export class Panadapter extends Component {
  /**
   * Options are passed to both children; `spectrum` and `waterfall`
   * objects override per child, e.g. {spectrum:{minDb:-130}, waterfall:{rows:300}}.
   */
  constructor(el, options = {}) {
    super(el, options, {});
    this.el.classList.add('ham-panadapter');
    const o = this.options;
    const specEl = this.el.querySelector(':scope > .ham-spectrum') || this.el.appendChild(h('div', { class: 'ham-spectrum' }));
    const wfEl = this.el.querySelector(':scope > .ham-waterfall') || this.el.appendChild(h('div', { class: 'ham-waterfall' }));
    // minDb/maxDb set the spectrum scale; the waterfall uses wfMinDb/wfMaxDb
    // (its own defaults otherwise), since a good trace range is not a good color range.
    const { spectrum: so = {}, waterfall: wo = {}, minDb, maxDb, wfMinDb, wfMaxDb, channels, ...shared } = o;
    const levels = (a, b) => ({ ...(a != null ? { minDb: a } : {}), ...(b != null ? { maxDb: b } : {}) });
    this.spectrum = new Spectrum(specEl, { ...shared, ...levels(minDb, maxDb), channels, ...so });
    this.waterfall = new Waterfall(wfEl, { ...shared, readout: false, ...levels(wfMinDb, wfMaxDb), ...wo, view: this.spectrum.view });
    this.view = this.spectrum.view;

    // keep both dials in step whichever child was tuned
    // (checked after dispatch so outer listeners can still cancel the tune)
    this.listen(this.el, 'ham:tune', (e) => {
      if (o.autoDial === false) return;
      queueMicrotask(() => { if (!e.defaultPrevented) this.setDial(e.detail.hz); });
    });
    // the waterfall outlines the channel picked on the spectrum's channel strip
    this.listen(this.el, 'ham:channel', (e) => {
      queueMicrotask(() => { if (!e.defaultPrevented) this.waterfall.setChannel(this.spectrum.channel); });
    });
  }

  /** Feed one frame to both views. */
  push(bins, range) {
    this.spectrum.update(bins, range);
    this.waterfall.push(bins, range);
  }
  update(bins, range) { this.push(bins, range); }

  setDial(hz) { this.spectrum.setDial(hz); this.waterfall.setDial(hz); }
  setPassband(pb) { this.spectrum.setPassband(pb); this.waterfall.setPassband(pb); }
  setMarkers(m) { this.spectrum.setMarkers(m); this.waterfall.setMarkers(m); }
  setDragTune(mode) { this.spectrum.setDragTune(mode); this.waterfall.setDragTune(mode); }
  setChannels(plan) { this.spectrum.setChannels(plan); this.waterfall.setChannel(this.spectrum.channel); }
  selectChannel(hz, opts) { const ch = this.spectrum.selectChannel(hz, opts); this.waterfall.setChannel(ch); return ch; }
  setTransmitting(on) { this.spectrum.setTransmitting(on); this.waterfall.setTransmitting(on); }
  setDataRange(start, span) { this.spectrum.setDataRange(start, span); this.waterfall.setDataRange(start, span); }

  destroy() {
    this.spectrum.destroy();
    this.waterfall.destroy();
    super.destroy();
  }
}
