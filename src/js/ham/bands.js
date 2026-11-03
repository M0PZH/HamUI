// Amateur bands (common IARU allocations; check your local regulations).
// `dial` is a sensible default frequency: the FT8 watering hole where one exists.

export const bands = [
  { name: '160m', low: 1800000, high: 2000000, dial: 1840000, ft8: 1840000 },
  { name: '80m', low: 3500000, high: 4000000, dial: 3573000, ft8: 3573000 },
  { name: '60m', low: 5351500, high: 5366500, dial: 5357000, ft8: 5357000 },
  { name: '40m', low: 7000000, high: 7300000, dial: 7074000, ft8: 7074000 },
  { name: '30m', low: 10100000, high: 10150000, dial: 10136000, ft8: 10136000 },
  { name: '20m', low: 14000000, high: 14350000, dial: 14074000, ft8: 14074000 },
  { name: '17m', low: 18068000, high: 18168000, dial: 18100000, ft8: 18100000 },
  { name: '15m', low: 21000000, high: 21450000, dial: 21074000, ft8: 21074000 },
  { name: '12m', low: 24890000, high: 24990000, dial: 24915000, ft8: 24915000 },
  { name: '10m', low: 28000000, high: 29700000, dial: 28074000, ft8: 28074000 },
  { name: '6m', low: 50000000, high: 54000000, dial: 50313000, ft8: 50313000 },
  { name: '2m', low: 144000000, high: 148000000, dial: 144174000, ft8: 144174000 },
  { name: '70cm', low: 420000000, high: 450000000, dial: 432200000, ft8: null },
];

export const HF_BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

export function getBand(name) {
  return bands.find((b) => b.name === name) || null;
}

/** The band containing `hz`, or null. */
export function bandForFrequency(hz) {
  return bands.find((b) => hz >= b.low && hz <= b.high) || null;
}

export const modes = ['LSB', 'USB', 'CW', 'AM', 'FM', 'DATA'];

/** Conventional sideband: LSB below 10 MHz (except 60 m), USB above. */
export function defaultMode(hz) {
  if (hz >= 5351500 && hz <= 5366500) return 'USB';
  return hz < 10e6 ? 'LSB' : 'USB';
}

/**
 * Receive passband relative to the dial, in Hz.
 * @param {string} mode
 * @param {number} [width] filter width in Hz
 * @returns {[number, number]}
 */
export function passbandFor(mode, width) {
  switch (mode) {
    case 'LSB': { const w = width ?? 2700; return [-(w + 100), -100]; }
    case 'CW': { const w = width ?? 500; return [-w / 2, w / 2]; }
    case 'AM': { const w = width ?? 6000; return [-w / 2, w / 2]; }
    case 'FM': { const w = width ?? 12000; return [-w / 2, w / 2]; }
    case 'DATA':
    case 'USB':
    default: { const w = width ?? (mode === 'DATA' ? 3000 : 2700); return [100, w + 100]; }
  }
}
