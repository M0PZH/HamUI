// Haptic feedback with a pluggable backend.
//
// Browsers cannot drive a laptop trackpad's haptics; the only web API is
// navigator.vibrate (Android). Components call haptics.fire(kind) at detents
// and the backend decides what to do, so a native shell can route it to the
// platform, e.g. in Tauri on macOS (NSHapticFeedbackManager):
//
//   HamUI.haptics.use((kind) => invoke('haptic', { kind }));
//
// Kinds:
//   'tick'   a detent: one tuning step, one knob step
//   'select' a discrete choice changed (segmented, band, mode)
//   'snap'   something lined up (a widget snapped into place, reset to default)
//   'edge'   a limit was hit (min/max)
//   'press'  a press registered (hold-to-talk, long-press)

const VIBRATE = { tick: 6, select: 10, snap: 12, edge: 20, press: 15 };
const MIN_GAP = { tick: 28, edge: 120 }; // ms; rapid scrolling should not merge into a buzz

/** Built-in backend: navigator.vibrate where it exists (Android browsers). */
export function vibrateBackend(kind) {
  const ms = VIBRATE[kind];
  if (!ms || typeof navigator === 'undefined' || !navigator.vibrate) return;
  // Chrome refuses (with a console warning) before the first user activation
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate(ms); } catch { /* not allowed here */ }
}

let backend = vibrateBackend;
let enabled = true;
const last = {};

export const haptics = {
  /** Turn all haptic feedback on or off. */
  get enabled() { return enabled; },
  set enabled(v) { enabled = !!v; },

  /**
   * Replace the backend: `fn(kind, detail)`. Pass null to silence,
   * or nothing to restore the built-in vibrate backend.
   */
  use(fn = vibrateBackend) { backend = typeof fn === 'function' ? fn : null; return haptics; },

  /** True when something will happen on fire() (a custom backend, or vibrate). */
  get available() {
    if (!enabled || !backend) return false;
    return backend !== vibrateBackend || (typeof navigator !== 'undefined' && !!navigator.vibrate);
  },

  /** Request feedback of `kind`. Cheap to call often: ticks are rate-limited. */
  fire(kind = 'tick', detail = {}) {
    if (!enabled || !backend) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const gap = MIN_GAP[kind];
    if (gap && now - (last[kind] ?? -Infinity) < gap) return;
    last[kind] = now;
    try { backend(kind, detail); } catch (e) { console.warn('HamUI haptics backend failed', e); }
  },
};
