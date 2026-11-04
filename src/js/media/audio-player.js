// AudioStreamPlayer: plays streamed PCM (DATV audio, SDR audio over a
// WebSocket, ...) through an AudioWorklet ring buffer that absorbs the clock
// difference between the sender and the sound card, and raises its buffer
// target when the arrival jitter grows.
//
//   const audio = new AudioStreamPlayer({ target: 0.12 });
//   button.onclick = () => audio.start();         // needs a click or tap
//   ws.onmessage = (e) => audio.push(new Int16Array(e.data), { rate: 12000 });
//   audio.volume = 0.7; audio.muted = false;
//   audio.stats();    // {playing, fill, target, minTarget, jitter, ppm, underruns, drops}
//   audio.level();    // 0..1 (-60..0 dBFS), for a meter
//
// Stream time: pass `ticks` (90 kHz, unwrapped; e.g. MPEG PTS through
// PtsUnwrapper) or `time` (seconds) per chunk for A/V sync and jitter
// tracking; without either, chunks are taken as back to back.
import { PTS_HZ } from './pts.js';
import { AudioClock, JitterEstimator, audioTarget } from './sync.js';
import { loadWorklet, PROCESSOR_NAME } from './worklet.js';

const nowS = () => performance.now() / 1000;

export class AudioStreamPlayer extends EventTarget {
  /**
   * @param {object} [o]
   * @param {number} [o.target=0.12]    minimum buffer, seconds (0.04..1); jitter can raise it (to 1 s)
   * @param {boolean} [o.adaptive=true] raise the target to cover the measured arrival jitter
   * @param {number} [o.channels=2]     output channels (mono input is copied to both)
   * @param {AudioContext} [o.context]  use an existing context
   * @param {AudioNode} [o.destination] connect here instead of context.destination
   */
  constructor({ target = 0.12, adaptive = true, channels = 2, context = null, destination = null } = {}) {
    super();
    this.minTarget = clampTarget(target);
    this.effTarget = this.minTarget;
    this.adaptive = adaptive;
    this.channels = channels;
    this.ctx = context;
    this._externalCtx = !!context;
    this._destination = destination;
    this.node = null;
    this.gain = null;
    this.analyser = null;
    this.gen = 0;
    this.rep = null;
    this.clock = new AudioClock();
    this.jitter = new JitterEstimator();
    this._volume = 1;
    this._muted = false;
    this._streamTicks = null; // running stream time when chunks carry none
    this._adaptAt = 0;
    this._starting = null;
    this._levelBuf = null;
  }

  /** True when AudioWorklet exists here (it needs a secure page). */
  static get supported() { return typeof AudioWorkletNode === 'function'; }

  /** Start (or resume) sound. Call it from a click or tap: browsers block audio otherwise. */
  start() {
    if (this.ctx && this.node) return this.ctx.resume().then(() => this._changed());
    if (this._starting) return this._starting;
    if (!AudioStreamPlayer.supported) return Promise.reject(new Error('AudioWorklet is not available (it needs https or localhost)'));
    const ctx = this.ctx || (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    const resumed = ctx.resume(); // still inside the gesture: Safari only starts audio from one
    this._starting = loadWorklet(ctx).then(async () => {
      if (this.closed) return;
      this.node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
        numberOfInputs: 0, outputChannelCount: [this.channels],
        processorOptions: { target: this.effTarget, gen: this.gen },
      });
      this.gain = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.node.connect(this.gain);
      this.node.connect(this.analyser); // the meter reads the signal, before the volume
      this.gain.connect(this._destination || ctx.destination);
      this._applyGain();
      this.node.port.onmessage = (e) => {
        if (e.data.gen !== this.gen) return;
        this.rep = e.data;
        this.clock.update(e.data);
        this.dispatchEvent(new CustomEvent('report', { detail: e.data }));
      };
      ctx.addEventListener?.('statechange', () => this._changed());
      await resumed.catch(() => {});
      await ctx.resume().catch(() => {});
      this._changed();
    }).finally(() => { this._starting = null; });
    return this._starting;
  }

  /** Started and allowed to play. */
  get running() { return !!this.node && this.ctx?.state === 'running'; }
  /** Not started yet, or the browser is holding the sound back until a click. */
  get blocked() { return !this.running; }

  get volume() { return this._volume; }
  set volume(v) { this._volume = Math.max(0, Math.min(1, +v || 0)); this._applyGain(); }
  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; this._applyGain(); }
  _applyGain() { if (this.gain) this.gain.gain.value = this._muted ? 0 : this._volume; }

  /**
   * Queue audio. Before start() it is dropped (the stream time still advances).
   * @param {Float32Array[]|Float32Array|Int16Array} data  planes, or one buffer (interleaved when `channels` > 1)
   * @param {object} [o]
   * @param {number} [o.rate=48000]  sample rate of the data
   * @param {number} [o.channels=1]  channels interleaved in a single buffer
   * @param {number} [o.ticks]       stream time of the first sample, 90 kHz ticks
   * @param {number} [o.time]        ... or in seconds
   * @param {number|false} [o.arrival]  when this audio arrived from the network, performance.now() seconds
   *   (default: now). Pass the real arrival when the audio was decoded or held first, or false to leave
   *   the jitter estimate alone (feed it with noteArrival() instead).
   */
  push(data, { rate = 48000, channels = 1, ticks, time, arrival } = {}) {
    const planes = toPlanes(data, channels);
    const frames = planes[0]?.length || 0;
    if (!frames) return;
    const t = ticks ?? (time != null ? time * PTS_HZ : this._streamTicks ?? 0);
    this._streamTicks = t + (frames / rate) * PTS_HZ;
    if (arrival !== false) this.noteArrival(t, arrival ?? nowS());
    if (!this.node) return;
    this.node.port.postMessage({ type: 'pcm', planes, ticks: t, rate, gen: this.gen }, planes.map((p) => p.buffer).filter(uniqueBuffers()));
  }

  /**
   * Record that stream time `ticks` (90 kHz) arrived at `atSec` (performance.now() seconds).
   * The spread of stream time minus arrival over the last 10 s is the jitter the target covers.
   */
  noteArrival(ticks, atSec = nowS()) {
    this.jitter.add(ticks / PTS_HZ - atSec, atSec);
    if (this.adaptive) this._adaptTarget();
  }

  /** Drop everything buffered (a channel change, a new stream); the next audio prefills again. */
  flush() {
    this.gen++;
    this.rep = null;
    this.clock.reset();
    this.jitter.reset();
    this._streamTicks = null;
    this.node?.port.postMessage({ type: 'flush', gen: this.gen });
  }

  /** Minimum buffer in seconds (0.04..1). With adaptive: false it is the target. */
  setTarget(sec) { this.minTarget = clampTarget(sec); this._adaptTarget(true); }

  _adaptTarget(force = false) {
    const t = nowS();
    if (!force && t - this._adaptAt < 1) return;
    this._adaptAt = t;
    const j = this.jitter, known = j.t.length > 1 ? j.t[j.t.length - 1] - j.t[0] : 0;
    // until a few seconds of arrivals are known, start with some reserve
    const min = this.adaptive && known < 3 ? Math.max(this.minTarget, 0.25) : this.minTarget;
    const eff = this.adaptive ? audioTarget(min, j.spread) : this.minTarget;
    if (force || Math.abs(eff - this.effTarget) > 0.015) {
      this.effTarget = eff;
      this.node?.port.postMessage({ type: 'target', value: eff });
    }
  }

  /** AudioContext time being heard now (the output latency included). */
  heardTime() {
    const c = this.ctx;
    if (!c) return null;
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return c.currentTime - (c.outputLatency || c.baseLatency || 0);
  }

  /** Stream position being heard now in 90 kHz ticks (the A/V master clock), or null. */
  position() { const h = this.heardTime(); return h == null ? null : this.clock.ticksAt(h); }

  /** Signal level for a meter: peak of the last ~20 ms on a -60..0 dBFS scale, as 0..1. */
  level() {
    if (!this.analyser) return 0;
    if (!this._levelBuf || this._levelBuf.length !== this.analyser.fftSize) this._levelBuf = new Float32Array(this.analyser.fftSize);
    return analyserLevel(this.analyser, this._levelBuf);
  }

  stats() {
    const r = this.rep;
    return {
      running: this.running,
      playing: !!r?.playing,
      fill: r?.fill ?? null,
      target: r?.target ?? this.effTarget,
      minTarget: this.minTarget,
      jitter: this.jitter.spread,
      ppm: r ? r.adj * 1e6 : null,
      underruns: r?.underruns ?? 0,
      drops: r?.drops ?? 0,
      droppedSeconds: r?.droppedSeconds ?? 0,
    };
  }

  _changed() { this.dispatchEvent(new CustomEvent('statechange', { detail: { running: this.running } })); }

  close() {
    this.closed = true;
    this.node?.disconnect();
    this.gain?.disconnect();
    this.analyser?.disconnect();
    this.node = null;
    // only close a context we made
    if (this.ctx && !this._externalCtx) this.ctx.close?.().catch(() => {});
  }
}

function clampTarget(s) { return Math.max(0.04, Math.min(1, +s || 0.12)); }

/** Peak of an AnalyserNode's current window on a -60..0 dBFS scale, as 0..1 (for a meter). */
export function analyserLevel(analyser, buf) {
  if (!analyser) return 0;
  const b = buf && buf.length === analyser.fftSize ? buf : new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(b);
  let peak = 0;
  for (const v of b) { const x = Math.abs(v); if (x > peak) peak = x; }
  return peak > 0 ? Math.max(0, Math.min(1, 1 + (20 * Math.log10(peak)) / 60)) : 0;
}

function uniqueBuffers() { const seen = new Set(); return (b) => (seen.has(b) ? false : (seen.add(b), true)); }

/** Normalise input to Float32 planes. Copies, so the caller's buffers stay theirs. */
export function toPlanes(data, channels = 1) {
  if (Array.isArray(data)) return data.map((p) => (p instanceof Float32Array ? p.slice() : Float32Array.from(p)));
  const int = data instanceof Int16Array;
  const k = int ? 1 / 32768 : 1;
  const n = Math.floor(data.length / channels);
  const planes = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0, j = 0; i < n; i++) for (let c = 0; c < channels; c++, j++) planes[c][i] = data[j] * k;
  return planes;
}
