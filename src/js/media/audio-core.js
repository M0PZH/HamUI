// Audio playout core: a PTS-stamped sample queue read by an adaptive
// resampler whose ratio a slow PI controller sets from the buffer fill.
//
// These classes also run inside the AudioWorklet: worklet.js rebuilds them
// from their source text (Function.prototype.toString), so they must stay
// self-contained: no imports, no module-level references other than each
// other, no DOM, no allocation in read(). Stream time is in 90 kHz ticks
// (MPEG PTS units; see pts.js for conversions).
//
// Why: the transmitter's audio clock and the sound card's clock differ by up
// to a few hundred ppm. Played at the nominal rate, the buffer would grow
// (latency creeps up) or run dry (clicks) over minutes. The controller nudges
// the read rate by at most `maxRatio` (±0.5 %, inaudible) so that the mean
// fill stays at `target`. A real underrun outputs silence and restarts at the
// target fill; an overrun beyond `overrunFactor` x target (e.g. after a
// network burst) drops the oldest audio to come back to the target at once.

export class FillController {
  /**
   * @param {object} o
   * @param {number} o.target    seconds of buffered audio to hold
   * @param {number} o.kp        1/s: proportional gain (closed-loop time constant 1/kp)
   * @param {number} o.ki        1/s^2: integral gain (tracks a constant clock offset)
   * @param {number} o.maxRatio  largest rate change (0.005 = 0.5 %)
   * @param {number} o.tau       s: low-pass on the measured fill (chunked arrival makes it a sawtooth)
   */
  constructor({ target = 0.12, kp = 0.05, ki = 0.0012, maxRatio = 0.005, tau = 1.0 } = {}) {
    this.target = target;
    this.kp = kp;
    this.ki = ki;
    this.maxRatio = maxRatio;
    this.tau = tau;
    this.integral = 0;
    this.filtered = null;
    this.adj = 0;
  }

  /** Forget the fill history; `keepDrift` keeps the integral (the learned clock offset). */
  reset(keepDrift = true) {
    this.filtered = null;
    if (!keepDrift) this.integral = 0;
    this.adj = this.integral;
  }

  /**
   * @param {number} fill  seconds buffered now
   * @param {number} dt    seconds since the last update
   * @returns {number} rate adjustment: the reader consumes (1 + adj) x nominal
   */
  update(fill, dt) {
    if (this.filtered == null) this.filtered = fill;
    else this.filtered += (fill - this.filtered) * (1 - Math.exp(-dt / this.tau));
    const e = this.filtered - this.target;
    const m = this.maxRatio;
    this.integral = Math.max(-m, Math.min(m, this.integral + this.ki * e * dt));
    this.adj = Math.max(-m, Math.min(m, this.kp * e + this.integral));
    return this.adj;
  }
}

export class AudioRing {
  /**
   * @param {object} o
   * @param {number} o.inRate   stream sample rate
   * @param {number} o.outRate  output (AudioContext) sample rate
   * @param {number} o.target   seconds (40..500 ms)
   * @param {number} o.overrunFactor  drop to target when the fill exceeds this x target
   * @param {number} o.maxSeconds     hard cap on buffered audio
   */
  constructor({ inRate = 48000, outRate = 48000, target = 0.12, overrunFactor = 3, maxSeconds = 4, controller = {} } = {}) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.overrunFactor = overrunFactor;
    this.maxSeconds = maxSeconds;
    this.ctl = new FillController({ target, ...controller });
    this.chunks = [];        // {planes: Float32Array[], length, ticks}
    this.pos = 0;            // fractional read position in chunks[0]
    this.frames = 0;         // input frames buffered from chunks[0] start
    this.playing = false;    // false: prefilling (silence out)
    this.stats = { underruns: 0, drops: 0, droppedSeconds: 0, played: 0 };
  }

  get target() { return this.ctl.target; }
  setTarget(t) { this.ctl.target = t; }

  /** Seconds of input buffered ahead of the read position. */
  get fill() { return Math.max(0, this.frames - this.pos) / this.inRate; }

  /** Stream position (ticks) at the read position, or null when empty. */
  position() {
    const c = this.chunks[0];
    if (!c || c.ticks == null) return this._lastTicks ?? null;
    return c.ticks + (this.pos * 90000) / this.inRate;
  }

  setRates(inRate, outRate) {
    if (inRate === this.inRate && outRate === this.outRate) return;
    this.flush();
    this.inRate = inRate;
    this.outRate = outRate;
  }

  /** Remove everything; the next audio prefills to the target again. */
  flush() {
    this.chunks.length = 0;
    this.pos = 0;
    this.frames = 0;
    this.playing = false;
    this._lastTicks = null;
    this.ctl.reset(true);
  }

  /**
   * Queue decoded audio.
   * @param {Float32Array[]} planes  one array per channel, equal lengths
   * @param {number|null} ticks      PTS of the first sample (unwrapped 90 kHz ticks)
   */
  push(planes, ticks) {
    const length = planes[0]?.length ?? 0;
    if (!length) return;
    this.chunks.push({ planes, length, ticks });
    this.frames += length;
    const max = this.maxSeconds * this.inRate;
    if (this.frames - this.pos > max) this._drop(this.frames - this.pos - this.ctl.target * this.inRate);
    else if (this.playing && this.fill > this.overrunFactor * this.ctl.target) {
      this._drop((this.fill - this.ctl.target) * this.inRate);
    }
  }

  /** Skip `n` input frames from the read position (oldest audio). */
  _drop(n) {
    if (n <= 0) return;
    this.stats.drops++;
    this.stats.droppedSeconds += n / this.inRate;
    this.pos += n;
    this._advance();
    this.ctl.reset(true);
  }

  _advance() {
    while (this.chunks.length && this.pos >= this.chunks[0].length) {
      const c = this.chunks.shift();
      this.pos -= c.length;
      this.frames -= c.length;
      if (c.ticks != null) this._lastTicks = c.ticks + (c.length * 90000) / this.inRate;
    }
    if (!this.chunks.length) { this.pos = 0; this.frames = 0; }
  }

  /**
   * Render `n` output frames into `out` (Float32Array per output channel).
   * @param {Float32Array[]} out
   * @param {number} n
   */
  read(out, n) {
    const dt = n / this.outRate;
    if (!this.playing) {
      if (this.fill >= this.ctl.target && this.chunks.length) {
        this.playing = true;
        this.ctl.reset(true);
      } else {
        for (const ch of out) ch.fill(0, 0, n);
        return;
      }
    }
    const adj = this.ctl.update(this.fill, dt);
    const step = (this.inRate / this.outRate) * (1 + adj);
    const outCh = out.length;
    let i = 0;
    for (; i < n; i++) {
      // need the sample at floor(pos) and the one after it
      let c = this.chunks[0];
      if (!c) break;
      let k = Math.floor(this.pos);
      if (k >= c.length) { this._advance(); c = this.chunks[0]; if (!c) break; k = Math.floor(this.pos); }
      const frac = this.pos - k;
      let next = c, kn = k + 1;
      if (kn >= c.length) { next = this.chunks[1]; kn = 0; if (!next) break; }
      const inCh = c.planes.length;
      for (let o = 0; o < outCh; o++) {
        const a = c.planes[o < inCh ? o : inCh - 1][k];
        const b = next.planes[o < next.planes.length ? o : next.planes.length - 1][kn];
        out[o][i] = a + (b - a) * frac;
      }
      this.pos += step;
    }
    if (i < n) {
      // ran dry: silence, then prefill to the target before playing again
      for (const ch of out) ch.fill(0, i, n);
      this.playing = false;
      this.stats.underruns++;
    }
    this.stats.played += i;
    this._advance();
  }

  /** What the main thread needs for the clock and the stats. */
  report() {
    return {
      ticks: this.position(),
      playing: this.playing,
      fill: this.fill,
      adj: this.ctl.adj,
      target: this.ctl.target,
      underruns: this.stats.underruns,
      drops: this.stats.drops,
      droppedSeconds: this.stats.droppedSeconds,
    };
  }
}
