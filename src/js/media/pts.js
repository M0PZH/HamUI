// MPEG-TS presentation time stamps: 33-bit counters of a 90 kHz clock that
// wrap every 2^33 ticks (26.5 h). Pure helpers, no DOM.

export const PTS_HZ = 90000;
export const PTS_WRAP = 2 ** 33;
const HALF = 2 ** 32;

/** a - b in ticks, taking the shorter way round the wrap: (-2^32, 2^32]. */
export function ptsDiff(a, b) {
  let d = (a - b) % PTS_WRAP;
  if (d > HALF) d -= PTS_WRAP;
  else if (d <= -HALF) d += PTS_WRAP;
  return d;
}

/**
 * Turns wrapping 33-bit PTS values into one continuous tick count, each value
 * unwrapped relative to the previous one. Feed it every stream of a program
 * (audio and video PTS stay within seconds of each other).
 */
export class PtsUnwrapper {
  constructor() { this.last = null; }
  unwrap(pts) {
    if (pts == null) return null;
    this.last = this.last == null ? pts : this.last + ptsDiff(pts, this.last);
    return this.last;
  }
  reset() { this.last = null; }
}

/** Ticks to integer microseconds (WebCodecs timestamps) and back. */
export const ticksToUs = (t) => Math.round((t * 1000) / 90);
export const usToTicks = (us) => (us * 90) / 1000;
