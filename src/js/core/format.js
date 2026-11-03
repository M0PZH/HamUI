// Frequency, level and axis formatting.

/** 14074000 -> "14.074.000" (dot-grouped Hz, the radio-panel convention). */
export function groupHz(hz) {
  const s = String(Math.round(Math.abs(hz)));
  return (hz < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Human frequency with unit: formatHz(14074000) -> "14.074000 MHz" */
export function formatHz(hz, { unit = 'auto', decimals } = {}) {
  const a = Math.abs(hz);
  const u = unit === 'auto' ? (a >= 1e9 ? 'GHz' : a >= 1e6 ? 'MHz' : a >= 1e3 ? 'kHz' : 'Hz') : unit;
  const div = { GHz: 1e9, MHz: 1e6, kHz: 1e3, Hz: 1 }[u];
  const d = decimals ?? { GHz: 6, MHz: 6, kHz: 3, Hz: 0 }[u];
  return `${(hz / div).toFixed(d)} ${u}`;
}

/** Span label: 12000 -> "12.0 kHz", 450 -> "450 Hz" */
export function formatSpan(hz) {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(hz < 1e7 ? 2 : 1)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(hz < 1e4 ? 2 : 1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

/**
 * Parse user input into Hz. Accepts units (Hz/k/kHz/M/MHz/G/GHz). Without a
 * unit: < 1000 is MHz, < 1e6 is kHz, else Hz. Dots used as thousands
 * separators ("14.074.000") are understood. Returns NaN on failure.
 */
export function parseFrequency(input) {
  let s = String(input).trim().replace(/,/g, '').replace(/\s+/g, '');
  const m = s.match(/^([0-9.]+)(hz|k|khz|m|mhz|g|ghz)?$/i);
  if (!m) return NaN;
  let num = m[1];
  if ((num.match(/\./g) || []).length > 1) num = num.replace(/\./g, '');
  const v = parseFloat(num);
  if (!Number.isFinite(v)) return NaN;
  const unit = (m[2] || '').toLowerCase();
  const mult = { hz: 1, k: 1e3, khz: 1e3, m: 1e6, mhz: 1e6, g: 1e9, ghz: 1e9 }[unit];
  if (mult) return Math.round(v * mult);
  if (v < 1000) return Math.round(v * 1e6);
  if (v < 1e6) return Math.round(v * 1e3);
  return Math.round(v);
}

/**
 * dBm -> S-units. HF: S9 = -73 dBm; VHF/UHF (vhf: true): S9 = -93 dBm. 6 dB per S-unit.
 * @returns {{s:number, over:number, label:string}}
 */
export function dbmToS(dbm, { vhf = false } = {}) {
  const s9 = vhf ? -93 : -73;
  if (dbm <= s9) {
    const s = Math.max(0, Math.round((dbm - (s9 - 54)) / 6));
    return { s, over: 0, label: `S${s}` };
  }
  const over = Math.round((dbm - s9) / 10) * 10;
  return { s: 9, over, label: over > 0 ? `S9+${over}` : 'S9' };
}

export function sToDbm(s, over = 0, { vhf = false } = {}) {
  return (vhf ? -93 : -73) - (9 - s) * 6 + over;
}

/** A 1/2/2.5/5 step giving roughly one tick per `targetPx`. */
export function niceStep(span, px, targetPx = 90) {
  const raw = span / Math.max(1, px / targetPx);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Axis tick label: MHz with as many decimals as the step needs. */
export function formatAxisHz(hz, step) {
  if (step >= 1e6) return (hz / 1e6).toFixed(0);
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step / 1e6) - 1e-9)));
  return (hz / 1e6).toFixed(decimals);
}
