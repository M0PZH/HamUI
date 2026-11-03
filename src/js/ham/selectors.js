// Band and mode selectors built on Segmented.
import { Segmented } from '../components/segmented.js';
import { resolve } from '../core/dom.js';
import { bands, HF_BANDS, getBand, bandForFrequency, modes } from './bands.js';

export class BandSelector extends Segmented {
  /**
   * options.bands: band names to show (default HF + 6m)
   * Emits ham:change {value, band} where band = {name, low, high, dial, ft8}.
   */
  constructor(el, options = {}) {
    const node = resolve(el);
    const list = options.bands || node?.dataset.bands;
    const names = typeof list === 'string' ? list.split(',').map((s) => s.trim()) : list || [...HF_BANDS, '6m'];
    super(node, { label: 'Band', ...options, bands: names, items: names }, {});
    this.el.classList.add('ham-seg-mono');
  }

  changeDetail(value) { return { value, band: getBand(value) }; }

  get band() { return getBand(this.value); }

  /** Highlight the band containing `hz` (none if outside every band). */
  follow(hz) {
    const b = bandForFrequency(hz);
    this.select(b ? b.name : null, { silent: true });
  }
}

export class ModeSelector extends Segmented {
  constructor(el, options = {}) {
    const node = resolve(el);
    const list = options.modes || node?.dataset.modes;
    const items = typeof list === 'string' ? list.split(',').map((s) => s.trim()) : list || modes;
    super(node, { label: 'Mode', ...options, modes: items, items }, {});
    this.el.classList.add('ham-seg-mono');
  }
}

export { bands };
