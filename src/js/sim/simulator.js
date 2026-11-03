// Synthetic band activity for demos and tests: noise floor plus FT8, JS8,
// CW and carrier signals placed around the band's FT8 frequency.
// Not a physical model; it only needs to look and behave plausibly.
import { bandForFrequency } from '../ham/bands.js';

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '/': '-..-.',
};
const CW_TEXT = ['CQ CQ DE JA1XYZ K', 'TEST BG4AAA', 'CQ DX DE DL2XYZ', 'R 599 TU 73', 'QRZ DE K1ABC'];

function keying(text) {
  const out = [];
  for (const word of text.split(' ')) {
    for (const ch of word) {
      const m = MORSE[ch];
      if (!m) continue;
      for (const s of m) out.push(...(s === '.' ? [1] : [1, 1, 1]), 0);
      out.push(0, 0);
    }
    out.push(0, 0, 0, 0);
  }
  out.push(...Array(16).fill(0));
  return out;
}

function hash(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class SignalSimulator {
  /**
   * @param {object} o
   * @param {number} o.startHz
   * @param {number} [o.spanHz=12000]
   * @param {number} [o.bins=2048]
   * @param {number} [o.floorDb=-120]
   */
  constructor({ startHz, spanHz = 12000, bins = 2048, floorDb = -120 } = {}) {
    this.spanHz = spanHz;
    this.bins = bins;
    this.floorDb = floorDb;
    this.attenuation = 0;
    this.lin = new Float64Array(bins);
    this.frame = new Float32Array(bins);
    this.setRange(startHz ?? 14074000 - spanHz * 0.375);
  }

  get range() { return { startHz: this.startHz, spanHz: this.spanHz }; }

  /** Move the simulated window; signals are re-seeded for the new place. */
  setRange(startHz, spanHz = this.spanHz) {
    this.startHz = startHz;
    this.spanHz = spanHz;
    this.binHz = spanHz / this.bins;
    this._seed();
  }

  _seed() {
    const r = rng(Math.round(this.startHz / 1000));
    const S = this.startHz, E = S + this.spanHz;
    const band = bandForFrequency(S + this.spanHz / 2);
    const ft8 = band?.ft8 ?? S + this.spanHz * 0.375;
    const sigs = [];
    const inRange = (f) => f > S && f < E;
    // FT8: 0.2–3 kHz above the dial, alternate 15 s slots
    for (let i = 0; i < 14; i++) {
      const f = ft8 + 200 + r() * 2700;
      if (inRange(f)) sigs.push({ type: 'fsk', f, amp: -112 + r() * 36, parity: i % 2, id: i, p: 0.5 + r() * 0.45, baud: 0.16, spacing: 6.25 });
    }
    // JS8 a few kHz up
    for (let i = 0; i < 4; i++) {
      const f = ft8 + 4200 + r() * 2200;
      if (inRange(f)) sigs.push({ type: 'fsk', f, amp: -108 + r() * 22, parity: i % 2, id: 40 + i, p: 0.6, baud: 0.16, spacing: 6.25 });
    }
    // CW below the FT8 segment
    for (let i = 0; i < 5; i++) {
      const f = ft8 - 4000 + r() * 2800;
      if (inRange(f)) sigs.push({ type: 'cw', f, amp: -102 + r() * 30, key: keying(CW_TEXT[i]), wpm: 15 + r() * 12, off: r() * 30000 });
    }
    // steady carriers
    sigs.push({ type: 'carrier', f: S + this.spanHz * (0.62 + r() * 0.05), amp: -104, drift: r() * 2 - 1 });
    sigs.push({ type: 'carrier', f: S + this.spanHz * 0.94, amp: -111, drift: 0 });
    this.signals = sigs;
  }

  _tone(fHz, dbm, widthBins) {
    const b = (fHz - this.startHz) / this.binHz;
    const lo = Math.max(0, Math.floor(b - widthBins * 3));
    const hi = Math.min(this.bins - 1, Math.ceil(b + widthBins * 3));
    const p = 10 ** (dbm / 10);
    for (let i = lo; i <= hi; i++) { const d = (i - b) / widthBins; this.lin[i] += p * Math.exp(-0.5 * d * d); }
  }

  /** Produce one frame (dBm per bin) for time `t` (ms since epoch). */
  next(t = Date.now()) {
    const n = this.bins, lin = this.lin, att = -this.attenuation;
    const floor = this.floorDb + att * 0.2;
    for (let i = 0; i < n; i++) {
      const u = Math.random() || 1e-12;
      const shape = 1.5 * Math.cos((i / n) * Math.PI * 2 - 0.4);
      lin[i] = 10 ** ((floor + shape + 10 * Math.log10(-Math.log(u)) * 0.55) / 10);
    }
    const slot = Math.floor(t / 15000);
    const st = (t % 15000) / 1000;
    for (const s of this.signals) {
      if (s.type === 'fsk') {
        if (slot % 2 !== s.parity || hash(s.id, slot) > s.p || st < 0.5 || st > 13.14) continue;
        const sym = Math.floor((st - 0.5) / s.baud);
        const tone = Math.floor(hash(s.id * 97 + slot, sym) * 8);
        this._tone(s.f + tone * s.spacing, s.amp + att + 2.5 * Math.sin(t / 3100 + s.id), 0.6);
      } else if (s.type === 'cw') {
        const dot = 1200 / s.wpm;
        if (s.key[Math.floor((t + s.off) / dot) % s.key.length]) this._tone(s.f, s.amp + att + 1.5 * Math.sin(t / 900), 0.9);
      } else {
        this._tone(s.f + s.drift * Math.sin(t / 20000) * 40, s.amp + att, 0.7);
      }
    }
    for (let i = 0; i < n; i++) this.frame[i] = 10 * Math.log10(lin[i]);
    return this.frame;
  }

  /** Total power (dBm) of the last frame between two absolute frequencies. */
  power(loHz, hiHz) {
    const b0 = Math.max(0, Math.floor((loHz - this.startHz) / this.binHz));
    const b1 = Math.min(this.bins, Math.ceil((hiHz - this.startHz) / this.binHz));
    let p = 0;
    for (let i = b0; i < b1; i++) p += this.lin[i];
    return p > 0 ? 10 * Math.log10(p) : -140;
  }
}
