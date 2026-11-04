// HamUI — public API.
import { getInstance, resolve } from './core/dom.js';
import { bindRanges } from './components/range.js';
import { bindTooltips } from './components/tooltip.js';
import { bindModalTriggers, Modal } from './components/modal.js';
import { Tabs } from './components/tabs.js';
import { Segmented } from './components/segmented.js';
import { toast } from './components/toast.js';
import { Spectrum } from './ham/spectrum.js';
import { Waterfall } from './ham/waterfall.js';
import { Panadapter } from './ham/panadapter.js';
import { bandplans, formatSymbolRate } from './ham/channels.js';
import { Meter, meterPresets } from './ham/meter.js';
import { FrequencyDisplay } from './ham/frequency.js';
import { Knob } from './ham/knob.js';
import { BandSelector, ModeSelector } from './ham/selectors.js';
import { Clock, TxIndicator, Ptt } from './ham/station.js';
import { FrequencyView, linkView } from './ham/view.js';
import { bands, HF_BANDS, getBand, bandForFrequency, modes, defaultMode, passbandFor } from './ham/bands.js';
import { SignalSimulator } from './sim/simulator.js';
import { DvbS2Simulator } from './sim/dvbs2-sim.js';
import { Constellation } from './ham/constellation.js';
import { TrendChart } from './ham/trend.js';
import { LockStatus } from './ham/lock-status.js';
import { MerMeter } from './ham/mer-meter.js';
import * as dvbs2 from './ham/dvbs2.js';
import { getTheme, setTheme, toggleTheme, resolvedTheme, onThemeChange, readTokens } from './core/theme.js';
import { colormaps } from './core/colormap.js';
import * as format from './core/format.js';
import { attachScopeGestures, setScrollDirection } from './core/gestures.js';
import { haptics } from './core/haptics.js';

/** data-ham="<name>" -> component class */
export const registry = {
  spectrum: Spectrum,
  waterfall: Waterfall,
  panadapter: Panadapter,
  meter: Meter,
  frequency: FrequencyDisplay,
  knob: Knob,
  segmented: Segmented,
  'band-selector': BandSelector,
  'mode-selector': ModeSelector,
  clock: Clock,
  trx: TxIndicator,
  ptt: Ptt,
  tabs: Tabs,
  modal: Modal,
  constellation: Constellation,
  trend: TrendChart,
  'lock-status': LockStatus,
  'mer-meter': MerMeter,
};

export const version = '0.1.0';

let globalsBound = false;

/**
 * Instantiate every [data-ham] element under `root` (skipping ones already
 * initialised) and install the delegated behaviours (tooltips, modal
 * triggers, range fill). Safe to call repeatedly.
 * @returns {Array} the created instances
 */
export function init(root = document) {
  const scope = resolve(root) || document;
  if (!globalsBound) {
    globalsBound = true;
    bindTooltips(document);
    bindModalTriggers(document);
    bindRanges(document);
  } else {
    scope.querySelectorAll?.('input.ham-range').forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  }
  const created = [];
  const nodes = scope.querySelectorAll ? [...scope.querySelectorAll('[data-ham]')] : [];
  if (scope.matches?.('[data-ham]')) nodes.unshift(scope);
  for (const el of nodes) {
    if (getInstance(el)) continue;
    // children of a panadapter are created by it
    if (el.closest('[data-ham="panadapter"]') && el.dataset.ham !== 'panadapter') continue;
    const Cls = registry[el.dataset.ham];
    if (!Cls) { console.warn(`HamUI: unknown component "${el.dataset.ham}"`, el); continue; }
    created.push(new Cls(el));
  }
  return created;
}

export const theme = { get: getTheme, set: setTheme, toggle: toggleTheme, resolved: resolvedTheme, onChange: onThemeChange, tokens: readTokens };

export {
  getInstance,
  Spectrum, Waterfall, Panadapter, FrequencyView, linkView,
  Meter, meterPresets, FrequencyDisplay, Knob,
  Segmented, BandSelector, ModeSelector,
  Clock, TxIndicator, Ptt,
  Tabs, Modal, toast,
  bands, HF_BANDS, getBand, bandForFrequency, modes, defaultMode, passbandFor,
  SignalSimulator, colormaps, format, attachScopeGestures, haptics, setScrollDirection,
  Constellation, TrendChart, LockStatus, MerMeter, DvbS2Simulator, dvbs2,
  bandplans, formatSymbolRate,
};

const HamUI = {
  version,
  init, registry, getInstance, theme,
  Spectrum, Waterfall, Panadapter, FrequencyView, linkView,
  Meter, meterPresets, FrequencyDisplay, Knob,
  Segmented, BandSelector, ModeSelector,
  Clock, TxIndicator, Ptt,
  Tabs, Modal, toast,
  bands, HF_BANDS, getBand, bandForFrequency, modes, defaultMode, passbandFor,
  SignalSimulator, colormaps, format, attachScopeGestures, haptics, setScrollDirection,
  Constellation, TrendChart, LockStatus, MerMeter, DvbS2Simulator, dvbs2,
  bandplans, formatSymbolRate,
};

export default HamUI;
