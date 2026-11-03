// Synthetic DVB-S2 demodulator output for demos: I/Q symbols for a MODCOD
// at a given MER (AWGN + a little phase noise), plus a plausible lock
// sequence. While searching, the carrier is not locked and the symbols
// smear into a ring; once the header is found they settle.
import { constellationPoints, getModcod } from '../ham/dvbs2.js';

function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class DvbS2Simulator {
  /**
   * @param {object} o
   * @param {string} [o.modcod='QPSK 1/2']
   * @param {number} [o.merDb=9]         mean MER
   * @param {number} [o.fadeDb=1.2]      slow MER wander (± dB)
   * @param {number} [o.phaseNoiseDeg=1.5]
   * @param {number} [o.symbols=600]     symbols per next()
   */
  constructor({ modcod = 'QPSK 1/2', merDb = 9, fadeDb = 1.2, phaseNoiseDeg = 1.5, symbols = 600 } = {}) {
    this.merDb = merDb;
    this.fadeDb = fadeDb;
    this.phaseNoise = (phaseNoiseDeg * Math.PI) / 180;
    this.symbols = symbols;
    this.out = new Float32Array(symbols * 2);
    this.present = true; // false = tuned to empty spectrum: noise only, never locks
    this.setModcod(modcod);
    this.acquire();
  }

  setModcod(name) {
    this.modcod = getModcod(name) || getModcod('QPSK 1/2');
    this.points = constellationPoints(this.modcod.modulation, this.modcod.rate);
    this.acquire();
  }

  /** Restart acquisition (as after retuning). */
  acquire() { this.t0 = performance.now(); this.phase = Math.random() * Math.PI * 2; }

  /** MER right now, including the slow fade. */
  currentMer(t = performance.now()) {
    return this.merDb + this.fadeDb * Math.sin(t / 2300) * Math.sin(t / 5100 + 1);
  }

  /**
   * Lock stage for LockStatus: 0 Search, 1 Header, 2 Demod, 3 FEC, 4 TS, 5 locked.
   * FEC never locks when the MER is below the MODCOD threshold.
   */
  stage(t = performance.now()) {
    if (!this.present) return 0;
    const dt = t - this.t0;
    const s = dt < 900 ? 0 : dt < 1500 ? 1 : dt < 2100 ? 2 : dt < 2500 ? 3 : dt < 2800 ? 4 : 5;
    return s >= 3 && this.currentMer(t) < this.modcod.esn0 ? 2 : s;
  }

  /** One block of interleaved I/Q. */
  next(t = performance.now()) {
    const st = this.stage(t), mer = this.currentMer(t);
    const sigma = Math.sqrt(10 ** (-mer / 10) / 2);
    const P = this.points, out = this.out;
    if (!this.present) {
      for (let k = 0; k < out.length; k++) out[k] = gauss() * 0.7;
      return out;
    }
    // carrier: free-running while searching, slow drift at header, locked after
    const drift = st === 0 ? 0.35 : st === 1 ? 0.01 : 0;
    for (let k = 0; k < this.symbols; k++) {
      this.phase += st === 0 ? (Math.random() - 0.5) * 0.9 + drift : drift;
      const [pi, pq] = P[(Math.random() * P.length) | 0];
      const ph = (st >= 2 ? 0 : this.phase) + gauss() * this.phaseNoise;
      const c = Math.cos(ph), s = Math.sin(ph);
      out[2 * k] = pi * c - pq * s + gauss() * sigma;
      out[2 * k + 1] = pi * s + pq * c + gauss() * sigma;
    }
    return out;
  }
}
