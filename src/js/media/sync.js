// A/V synchronisation for one received program. Pure logic (no DOM, no
// WebCodecs): the app's player feeds it and acts on its answers; the unit
// tests drive it with simulated time. From the PlutoSAT station front end.
//
// One clock per slot. The master is the audio playout position: the PTS of
// the sample the AudioWorklet is playing (AudioRing.position(), reported to
// the main thread with the AudioContext time it refers to; AudioClock
// extrapolates between reports). A video frame is shown when its PTS comes
// due on that clock. With no audio (video-only service, codec not decodable,
// sound not allowed yet) an ArrivalClock maps PTS to performance.now() with a
// PI-controlled delay that holds a small jitter margin.
//
// Timelines (SyncCore). PTS are unwrapped (33-bit, 90 kHz). A video
// discontinuity flag, or a PTS jump of more than `jump` on either stream,
// starts a new timeline: both streams restart together at the next video key
// frame. The video decoder is reset there, decoded frames of the old
// timeline are dropped, the audio buffer is flushed, and audio resumes at the
// key frame's stream time (earlier audio is dropped; audio that arrived first
// is held, bounded). The server only sends a discontinuous video message on
// a key frame, so this costs no extra wait. An audio discontinuity flag with
// a continuous PTS (audio frames lost, queue cap) is only a gap: audio
// resumes with the next frame and the clock follows its PTS.
// At the start, video begins at the first key frame and audio at the same
// stream time. Audio-only services restart on the next audio frame.
//
// Epochs (optional). A sender that numbers its timelines puts `epoch` on
// every frame. Then a NEW epoch starts a new timeline (as above, without
// waiting for a flag or a jump; frames of the previous epoch that still
// arrive are dropped), and the discontinuity flag with the SAME epoch means
// data was dropped but the timeline is intact: video skips to the next key
// frame (`resync`: reset the decoder there), audio carries on, and the PTS
// step across the drop is not taken as a jump. Frames without `epoch` follow
// the rules above.
import { PtsUnwrapper, PTS_HZ } from './pts.js';

export const SYNC_DEFAULTS = Object.freeze({
  jump: 1.0,         // s: a PTS step larger than this starts a new timeline
  holdAudio: 2.0,    // s of audio held while waiting for a video key frame
});

export class SyncCore {
  constructor(opts = {}) {
    this.o = { ...SYNC_DEFAULTS, ...opts };
    this.unwrapper = new PtsUnwrapper();
    this.hasVideo = true;    // the program has a video stream this client decodes
    this.hasAudio = true;    // ... an audio stream this client plays
    this.stats = { timelines: 0, videoSkipped: 0, videoDiscontinuities: 0, audioGaps: 0, audioDropped: 0, jumps: 0, epochs: 0, videoResyncs: 0, stale: 0 };
    this.reset();
  }

  /** Back to the start state: wait for a video key frame (or the first audio frame without video). */
  reset() {
    this.waiting = true;       // no timeline: waiting for its first frame
    this.startTicks = null;    // stream time where the current timeline starts
    this.lastVideo = null;
    this.lastAudioEnd = null;
    this.held = [];
    this.videoResync = false;  // same-epoch drop: video waits for a key frame, audio plays on
    this.epoch = null;         // current epoch, when the sender numbers its timelines
    this.prevEpoch = null;
    this.unwrapper.reset();
  }

  /** Classify a frame's epoch: null (none, or nothing new), 'new', 'drop' or 'stale'. */
  _epoch(f) {
    const e = f.epoch;
    if (e == null) return null;
    if (this.epoch == null) { this.epoch = e; return null; }
    if (e === this.epoch) return f.discontinuity ? 'drop' : null;
    if (e === this.prevEpoch) { this.stats.stale++; return 'stale'; }
    const prev = this.epoch;
    this.reset();
    this.epoch = e;
    this.prevEpoch = prev;
    this.stats.epochs++;
    return 'new';
  }

  _begin(ticks) {
    this.waiting = false;
    this.startTicks = ticks;
    this.stats.timelines++;
    const release = [];
    for (const h of this.held) {
      if (h.ticks >= ticks) release.push(h);
      else this.stats.audioDropped++;
    }
    this.held = [];
    return release;
  }

  /** Start waiting for a new timeline (both streams). */
  _restart() {
    this.waiting = true;
    this.videoResync = false;
    this.lastAudioEnd = null;
  }

  /**
   * An encoded video AU arrived.
   * @param {{pts:number|null, dts:number|null, key:boolean, discontinuity:boolean, epoch?:number}} f
   * @returns {{action:'decode'|'drop', ticks?:number, decodeTicks?:number, timeline?:boolean, resync?:boolean, release:Array}}
   *   ticks: unwrapped PTS (presentation), decodeTicks: unwrapped DTS;
   *   timeline: a new timeline starts with this key frame: reset the decoder,
   *   drop decoded frames, flush the audio buffer, then decode `release`
   *   (held audio, in order) and this AU.
   *   resync: video data was dropped (same epoch): reset the decoder and
   *   decode from this key frame; the timeline and the audio carry on.
   */
  video(f) {
    const ep = this._epoch(f);
    if (ep === 'stale') return { action: 'drop', release: [] };
    const raw = f.pts ?? f.dts;
    if (raw == null) return { action: 'drop', release: [] };
    const ticks = this.unwrapper.unwrap(raw);
    const decodeTicks = f.dts == null ? ticks : this.unwrapper.unwrap(f.dts);
    if (ep === 'drop') {
      if (!this.waiting) this.videoResync = true;
    } else {
      const jumped = this.lastVideo != null && Math.abs(ticks - this.lastVideo) > this.o.jump * PTS_HZ;
      if (f.discontinuity) this.stats.videoDiscontinuities++;
      if (jumped) this.stats.jumps++;
      if ((f.discontinuity || jumped) && !this.waiting) this._restart();
    }
    this.lastVideo = ticks;
    if (this.waiting) {
      if (!f.key) { this.stats.videoSkipped++; return { action: 'drop', release: [] }; }
      return { action: 'decode', ticks, decodeTicks, timeline: true, release: this._begin(ticks) };
    }
    if (this.videoResync) {
      if (!f.key) { this.stats.videoSkipped++; return { action: 'drop', release: [] }; }
      this.videoResync = false;
      this.stats.videoResyncs++;
      return { action: 'decode', ticks, decodeTicks, timeline: false, resync: true, release: [] };
    }
    return { action: 'decode', ticks, decodeTicks, timeline: false, release: [] };
  }

  /**
   * An encoded audio frame arrived (only while audio is played).
   * @param {{pts:number|null, discontinuity:boolean, epoch?:number}} f
   * @param {number} durationTicks  frame length in ticks (0 if unknown)
   * @returns {{action:'decode'|'hold'|'drop', ticks?:number, timeline?:boolean, release:Array}}
   *   timeline: (audio-only) a new timeline starts with this frame: flush the audio buffer.
   *   Held frames come back in a later result's `release` as {f, ticks}.
   */
  audio(f, durationTicks = 0) {
    const ep = this._epoch(f);
    if (ep === 'stale') return { action: 'drop', release: [] };
    const ticks = f.pts == null ? this.lastAudioEnd : this.unwrapper.unwrap(f.pts);
    if (ticks == null) return { action: 'drop', release: [] };
    const expected = this.lastAudioEnd;
    this.lastAudioEnd = ticks + durationTicks;
    const jumped = ep !== 'drop' && expected != null && Math.abs(ticks - expected) > this.o.jump * PTS_HZ;
    if (jumped) { this.stats.jumps++; if (!this.waiting) this._restart(); }
    else if (f.discontinuity) this.stats.audioGaps++;

    if (this.waiting) {
      if (this.hasVideo) return this._hold(f, ticks);
      return { action: 'decode', ticks, timeline: true, release: this._begin(ticks) };
    }
    if (ticks < this.startTicks) { this.stats.audioDropped++; return { action: 'drop', release: [] }; }
    return { action: 'decode', ticks, timeline: false, release: [] };
  }

  _hold(f, ticks) {
    this.held.push({ f, ticks });
    while (this.held.length > 1 && (ticks - this.held[0].ticks) / PTS_HZ > this.o.holdAudio) {
      this.held.shift();
      this.stats.audioDropped++;
    }
    return { action: 'hold', release: [] };
  }
}

/**
 * The audio playout position as a clock. `update()` takes the worklet's
 * reports ({ticks, playing, adj, ctxTime}: the stream position at AudioContext
 * time ctxTime, i.e. at the end of the rendered quantum); `ticksAt(heard)`
 * gives the position being heard at AudioContext time `heard` (from
 * getOutputTimestamp, so the output latency is included). While prefilling
 * or after an underrun the clock stands still.
 */
export class AudioClock {
  constructor({ maxExtrapolate = 0.2 } = {}) { this.maxExtrapolate = maxExtrapolate; this.rep = null; }
  update(rep) { this.rep = rep; }
  reset() { this.rep = null; }
  get running() { return !!(this.rep && this.rep.playing && this.rep.ticks != null); }
  ticksAt(heard) {
    const r = this.rep;
    if (!r || r.ticks == null) return null;
    if (!r.playing) return r.ticks;
    const dt = Math.min(heard - r.ctxTime, this.maxExtrapolate);
    return r.ticks + dt * PTS_HZ * (1 + (r.adj || 0));
  }
}

/**
 * Clock for video without audio: presentation time = PTS / 90 kHz + delay
 * (performance.now() seconds). A slow PI loop keeps the smallest recent
 * arrival margin (DTS due time minus arrival time) at `target`; the delay
 * changes by at most `maxRatio` (0.5 %) so motion stays smooth. A frame that
 * arrives late restarts at the target margin (the delay jumps up); when even
 * the smallest margin of a `window` exceeds `overrunFactor` x target (the
 * delay is far larger than the jitter needs, e.g. after a stall), the delay
 * jumps down to the target in one step. So neither a transmitter clock
 * offset nor jitter makes the latency grow.
 */
export class ArrivalClock {
  constructor({ target = 0.08, kp = 0.1, ki = 0.004, maxRatio = 0.005, rise = 0.02, overrunFactor = 3, window = 3 } = {}) {
    Object.assign(this, { target, kp, ki, maxRatio, rise, overrunFactor, window });
    this.stats = { late: 0, trims: 0 };
    this.reset();
  }

  reset() {
    this.delay = null;    // s
    this.lastNow = null;
    this.margin = null;   // decaying minimum of the arrival margin
    this.integral = 0;
    this.adj = 0;
    this.winStart = null;
    this.winMin = Infinity;
  }

  get running() { return this.delay != null; }

  timeOf(ticks) { return ticks / PTS_HZ + this.delay; }
  ticksAt(now) { return this.delay == null ? null : (now - this.delay) * PTS_HZ; }

  /** Continue from another clock's position (switching from the audio clock). */
  align(ticks, now) {
    this.delay = now - ticks / PTS_HZ;
    this.lastNow = now;
    this.margin = null;
    this.winStart = null;
  }

  /** An AU with decode time `decodeTicks` arrived at `now`. Returns its arrival margin (s). */
  arrive(decodeTicks, now) {
    if (this.delay == null) { this.align(decodeTicks, now); this.delay += this.target; return this.target; }
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    this.delay -= this.adj * dt;                      // the rate correction of the last interval
    const slack = this.timeOf(decodeTicks) - now;
    if (slack < 0) {
      this.delay += this.target - slack;
      this.stats.late++;
      this.margin = this.target;
      this.winStart = null;
      return slack;
    }
    // windowed minimum: a delay much larger than the jitter needs is trimmed at once
    if (this.winStart == null) { this.winStart = now; this.winMin = slack; }
    else this.winMin = Math.min(this.winMin, slack);
    if (now - this.winStart >= this.window) {
      if (this.winMin > this.overrunFactor * this.target) {
        this.delay -= this.winMin - this.target;
        this.stats.trims++;
        this.margin = this.target;
        this.winStart = null;
        return slack;
      }
      this.winStart = now; this.winMin = slack;
    }
    this.margin = this.margin == null ? slack : Math.min(slack, this.margin + this.rise * dt);
    const e = this.margin - this.target;
    const m = this.maxRatio;
    this.integral = Math.max(-m, Math.min(m, this.integral + this.ki * e * dt));
    this.adj = Math.max(-m, Math.min(m, this.kp * e + this.integral));
    return slack;
  }
}

/**
 * Arrival jitter of a stream: the spread (max - min) over the last `window`
 * seconds of "stream time minus arrival time". The audio buffer target is
 * raised to cover it (a bursty link needs more buffer than a smooth one).
 */
export class JitterEstimator {
  constructor({ window = 10 } = {}) { this.window = window; this.t = []; this.v = []; }
  add(lead, now) {
    this.t.push(now); this.v.push(lead);
    let k = 0;
    while (k < this.t.length && now - this.t[k] > this.window) k++;
    if (k) { this.t.splice(0, k); this.v.splice(0, k); }
  }
  /** max - min of the window, seconds (0 with fewer than 2 samples). */
  get spread() {
    if (this.v.length < 2) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const x of this.v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return hi - lo;
  }
  reset() { this.t.length = 0; this.v.length = 0; }
}

/** Audio buffer target: the user's minimum, raised to cover the measured jitter (capped). */
export function audioTarget(minTarget, spread, { margin = 0.04, max = 1.0 } = {}) {
  return Math.min(max, Math.max(minTarget, spread + margin));
}

/**
 * Decoded frames waiting for their time. Items: {ticks, frame, arrival}.
 * The caller closes every frame this hands back (shown or dropped).
 */
export class VideoQueue {
  constructor({ max = 8, interval = 0.04 } = {}) {
    this.max = max;
    this.interval = interval * PTS_HZ;   // frame interval (ticks), learned from the PTS
    this.items = [];
    this.lastTicks = null;
    this.stats = { late: 0, overflow: 0, shown: 0 };
  }

  get length() { return this.items.length; }

  /** Add a decoded frame (kept in PTS order). Returns items dropped to stay within `max`. */
  push(item) {
    if (this.lastTicks != null) {
      const d = item.ticks - this.lastTicks;
      if (d > 0 && d < 0.5 * PTS_HZ) this.interval += (d - this.interval) * 0.1;
    }
    this.lastTicks = item.ticks;
    const a = this.items;
    let i = a.length;
    while (i > 0 && a[i - 1].ticks > item.ticks) i--;
    a.splice(i, 0, item);
    const dropped = a.length > this.max ? a.splice(0, a.length - this.max) : [];
    this.stats.overflow += dropped.length;
    return dropped;
  }

  /**
   * The frame to show at stream position `pos` (ticks): the newest due frame,
   * unless it is late by more than one frame interval. Older due frames are dropped.
   * @returns {{show: object|null, dropped: object[]}}
   */
  pick(pos) {
    const a = this.items, dropped = [];
    let show = null;
    while (a.length && a[0].ticks <= pos) {
      if (show) dropped.push(show);
      show = a.shift();
    }
    if (show && pos - show.ticks > this.interval) { dropped.push(show); show = null; }
    this.stats.late += dropped.length;
    if (show) this.stats.shown++;
    return { show, dropped };
  }

  clear() { const a = this.items; this.items = []; this.lastTicks = null; return a; }
}

/**
 * Keep the decoder's queue short. Returns 'decode', 'skip' (a non-reference
 * AU while the queue is building up) or 'skip-to-key' (far behind: skip until
 * the next key frame).
 */
export function backlogPolicy(queueSize, { key, disposable }, { soft = 3, hard = 8 } = {}) {
  if (key) return 'decode';
  if (queueSize >= hard) return 'skip-to-key';
  if (queueSize >= soft && disposable) return 'skip';
  return 'decode';
}
