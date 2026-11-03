// DVB-S2 reference data and helpers: MODCODs, constellation geometry, MER.
//
// Es/N0 thresholds are the ideal quasi-error-free values for normal
// FECFRAMEs over AWGN (ETSI EN 302 307-1, table 13). Real receivers need
// roughly 0.5–1 dB more; DATV operators call MER minus this threshold the
// "D number" (decoding margin).

export const MODCODS = [
  ['QPSK', '1/4', -2.35], ['QPSK', '1/3', -1.24], ['QPSK', '2/5', -0.30], ['QPSK', '1/2', 1.00],
  ['QPSK', '3/5', 2.23], ['QPSK', '2/3', 3.10], ['QPSK', '3/4', 4.03], ['QPSK', '4/5', 4.68],
  ['QPSK', '5/6', 5.18], ['QPSK', '8/9', 6.20], ['QPSK', '9/10', 6.42],
  ['8PSK', '3/5', 5.50], ['8PSK', '2/3', 6.62], ['8PSK', '3/4', 7.91], ['8PSK', '5/6', 9.35],
  ['8PSK', '8/9', 10.69], ['8PSK', '9/10', 10.98],
  ['16APSK', '2/3', 8.97], ['16APSK', '3/4', 10.21], ['16APSK', '4/5', 11.03], ['16APSK', '5/6', 11.61],
  ['16APSK', '8/9', 12.89], ['16APSK', '9/10', 13.13],
  ['32APSK', '3/4', 12.73], ['32APSK', '4/5', 13.64], ['32APSK', '5/6', 14.28], ['32APSK', '8/9', 15.69],
  ['32APSK', '9/10', 16.05],
].map(([modulation, rate, esn0]) => ({ name: `${modulation} ${rate}`, modulation, rate, esn0 }));

const BITS = { QPSK: 2, '8PSK': 3, '16APSK': 4, '32APSK': 5 };

// APSK ring ratios by code rate (EN 302 307-1, tables 9 and 10)
const GAMMA16 = { '2/3': 3.15, '3/4': 2.85, '4/5': 2.75, '5/6': 2.70, '8/9': 2.60, '9/10': 2.57 };
const GAMMA32 = { '3/4': [2.84, 5.27], '4/5': [2.72, 4.87], '5/6': [2.64, 4.64], '8/9': [2.54, 4.33], '9/10': [2.53, 4.30] };

/** Look up a MODCOD by name ("8PSK 2/3") or parts. Returns null if unknown. */
export function getModcod(modulation, rate) {
  const name = rate ? `${modulation} ${rate}` : String(modulation);
  const norm = name.toUpperCase().replace(/\s+/g, ' ').trim();
  return MODCODS.find((m) => m.name === norm) || null;
}

/** Decoding margin (dB) for a measured MER: MER − required Es/N0. */
export function margin(merDb, modcod) {
  const m = typeof modcod === 'string' ? getModcod(modcod) : modcod;
  return m ? merDb - m.esn0 : NaN;
}

/**
 * Approximate useful bitrate for a symbol rate and MODCOD (normal frames,
 * pilots off): symbols × bits/symbol × code rate × framing efficiency.
 * Good to a few percent; for display, not for configuring a modulator.
 */
export function bitrate(symbolRate, modcod, { pilots = false } = {}) {
  const m = typeof modcod === 'string' ? getModcod(modcod) : modcod;
  if (!m) return NaN;
  const [a, b] = m.rate.split('/').map(Number);
  const bits = BITS[m.modulation];
  const slots = 64800 / bits / 90;                  // 90-symbol slots per FECFRAME
  const pilotSyms = pilots ? Math.floor((slots - 1) / 16) * 36 : 0;
  const framing = (slots * 90) / (slots * 90 + 90 + pilotSyms);
  const bch = 0.997;                                 // BCH parity + BB header, roughly
  return symbolRate * bits * (a / b) * framing * bch;
}

/**
 * Ideal constellation points, unit average power, as [[i, q], ...].
 * @param {'QPSK'|'8PSK'|'16APSK'|'32APSK'} modulation
 * @param {string} [rate] code rate; picks the APSK ring ratio
 */
export function constellationPoints(modulation, rate) {
  const mod = String(modulation).toUpperCase();
  const ring = (n, r, phase) => Array.from({ length: n }, (_, k) => {
    const a = phase + (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  let pts;
  if (mod === 'QPSK') pts = ring(4, 1, Math.PI / 4);
  else if (mod === '8PSK') pts = ring(8, 1, 0);
  else if (mod === '16APSK') {
    const g = GAMMA16[rate] ?? 2.85;
    pts = [...ring(4, 1, Math.PI / 4), ...ring(12, g, Math.PI / 12)];
  } else if (mod === '32APSK') {
    const [g1, g2] = GAMMA32[rate] ?? [2.84, 5.27];
    pts = [...ring(4, 1, Math.PI / 4), ...ring(12, g1, Math.PI / 12), ...ring(16, g2, 0)];
  } else return [];
  const p = Math.sqrt(pts.reduce((s, [i, q]) => s + i * i + q * q, 0) / pts.length);
  return pts.map(([i, q]) => [i / p, q / p]);
}

/**
 * Decision-directed MER in dB from interleaved I/Q symbols
 * ([i0, q0, i1, q1, ...]) and the ideal points they should sit on.
 * Symbols are scaled to unit average power first. Like any decision-
 * directed estimate it reads high at low MER (noise pushes symbols onto the
 * wrong point); prefer the demodulator's own MER where one is reported.
 */
export function measureMer(iq, points) {
  const n = iq.length >> 1;
  if (!n || !points.length) return NaN;
  let pw = 0;
  for (let k = 0; k < iq.length; k++) pw += iq[k] * iq[k];
  const s = 1 / Math.sqrt(pw / n || 1);
  let sig = 0, err = 0;
  for (let k = 0; k < n; k++) {
    const i = iq[2 * k] * s, q = iq[2 * k + 1] * s;
    let best = Infinity, bi = 0, bq = 0;
    for (const [pi, pq] of points) {
      const d = (i - pi) ** 2 + (q - pq) ** 2;
      if (d < best) { best = d; bi = pi; bq = pq; }
    }
    sig += bi * bi + bq * bq;
    err += best;
  }
  return 10 * Math.log10(sig / (err || 1e-12));
}
