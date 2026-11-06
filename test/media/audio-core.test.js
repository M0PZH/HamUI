import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRing, FillController } from '../../src/js/media/audio-core.js';

const OUT = 48000;
const Q = 128;   // render quantum

/**
 * Simulate a transmitter whose clock runs `ppm` off, sending 20 ms frames
 * (optionally in bursts), into a ring played by a 48 kHz sound card.
 * Returns stats and the worst filtered-fill error after `settle` seconds.
 */
function simulate({ ppm = 0, seconds = 3600, settle = 60, target = 0.12, frame = 960, burst = 1, jitter = 0, inRate = 48000, seed = 1 }) {
  const ring = new AudioRing({ inRate, outRate: OUT, target });
  const out = [new Float32Array(Q)];
  const plane = new Float32Array(frame);
  const rate = inRate * (1 + ppm * 1e-6);       // samples the transmitter produces per real second
  let rnd = seed;
  const random = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  let sent = 0, ticks = 0, nextBurstAt = 0;
  let worst = 0, minFill = Infinity, underrunsAfterSettle = 0, dropsAfterSettle = 0;
  const steps = Math.round((seconds * OUT) / Q);
  let u0 = 0, d0 = 0, captured = false;
  for (let s = 0; s < steps; s++) {
    const t = (s * Q) / OUT;
    // frames become available at the transmitter clock; delivered in bursts with jitter
    if (t >= nextBurstAt) {
      const due = Math.floor((t * rate) / frame) - sent;
      if (due >= burst || (burst === 1 && due > 0)) {
        for (let k = 0; k < due; k++) { ring.push([plane], ticks); ticks += (frame * 90000) / inRate; sent++; }
        nextBurstAt = t + jitter * random();
      }
    }
    ring.read(out, Q);
    if (t > settle) {
      if (!captured) { captured = true; u0 = ring.stats.underruns; d0 = ring.stats.drops; }
      worst = Math.max(worst, Math.abs(ring.ctl.filtered - target));
      minFill = Math.min(minFill, ring.fill);
    }
  }
  underrunsAfterSettle = ring.stats.underruns - u0;
  dropsAfterSettle = ring.stats.drops - d0;
  return { ring, worst, minFill, underrunsAfterSettle, dropsAfterSettle };
}

for (const ppm of [300, -300]) {
  test(`clock drift ${ppm} ppm for one hour: fill within 20 ms of target, no underruns or drops`, () => {
    const r = simulate({ ppm, seconds: 3600 });
    assert.ok(r.worst < 0.02, `worst filtered fill error ${(r.worst * 1000).toFixed(1)} ms`);
    assert.equal(r.underrunsAfterSettle, 0);
    assert.equal(r.dropsAfterSettle, 0);
    // the integrator learned the offset
    assert.ok(Math.abs(r.ring.ctl.integral - ppm * 1e-6) < 50e-6, `integral ${r.ring.ctl.integral * 1e6} ppm`);
  });
}

test('bursty arrival (100 ms bursts with jitter) at +200 ppm, 10 minutes', () => {
  const r = simulate({ ppm: 200, seconds: 600, burst: 5, jitter: 0.03 });
  assert.ok(r.worst < 0.02, `worst ${(r.worst * 1000).toFixed(1)} ms`);
  assert.equal(r.underrunsAfterSettle, 0);
  assert.ok(r.minFill > 0);
});

test('resampling: stream at 44.1 kHz into a 48 kHz context stays at target', () => {
  const r = simulate({ ppm: 0, seconds: 300, inRate: 44100, frame: 1024 });
  assert.ok(r.worst < 0.02);
  assert.equal(r.underrunsAfterSettle, 0);
});

test('prefill: silence until the target fill, then fade in from the first sample', () => {
  const ring = new AudioRing({ target: 0.1 });
  const out = [new Float32Array(Q), new Float32Array(Q)];
  const pcm = new Float32Array(960).fill(0.5);
  ring.push([pcm, pcm], 1000);
  ring.read(out, Q);
  assert.equal(ring.playing, false);
  assert.equal(out[0][5], 0);
  for (let k = 1; k < 6; k++) ring.push([pcm, pcm], 1000 + k * 1800);
  ring.read(out, Q);
  assert.equal(ring.playing, true);
  assert.ok(out[0][5] > 0 && out[0][5] < 0.02);
  ring.read(out, Q);
  assert.ok(Math.abs(out[0][Q - 1] - 0.5) < 1e-6);
  // position advanced by about one quantum from the first PTS
  assert.ok(Math.abs(ring.position() - (1000 + (2 * Q * 90000) / 48000)) < 2);
});

test('underrun: silence, counted once, restart at target fill', () => {
  const ring = new AudioRing({ target: 0.04 });
  const out = [new Float32Array(Q)];
  const pcm = new Float32Array(1920).fill(1);   // 40 ms
  ring.push([pcm], 0);
  let n = 0;
  while (ring.stats.underruns === 0 && n++ < 100) ring.read(out, Q);
  assert.equal(ring.stats.underruns, 1);
  assert.equal(ring.playing, false);
  ring.read(out, Q);
  assert.ok(out[0][0] >= 0 && out[0][0] < 1);
  ring.read(out, Q);
  ring.read(out, Q);
  assert.equal(out[0][Q - 1], 0);
  assert.equal(ring.stats.underruns, 1);       // prefilling is not another underrun
  ring.push([pcm], 3600);
  ring.read(out, Q);
  assert.equal(ring.playing, true);
});

test('overrun beyond 3x target drops the oldest audio back to the target in one step', () => {
  const ring = new AudioRing({ target: 0.1 });
  const out = [new Float32Array(Q)];
  const pcm = new Float32Array(4800);           // 100 ms
  ring.push([pcm], 0);
  ring.read(out, Q);                            // starts playing
  for (let k = 1; k <= 3; k++) ring.push([pcm], k * 9000);   // fill 0.4 s > 3 x target
  assert.equal(ring.stats.drops, 1);
  assert.ok(Math.abs(ring.fill - 0.1) < 0.003, `fill ${ring.fill}`);
  // the position jumped forward to the newest audio minus the target
  assert.ok(Math.abs(ring.position() - (4 * 9000 - 0.1 * 90000)) < 10);
});

test('controller output is limited to ±0.5 %', () => {
  const c = new FillController({ target: 0.1 });
  for (let k = 0; k < 10000; k++) c.update(2.0, 0.01);
  assert.equal(c.adj, 0.005);
  for (let k = 0; k < 100000; k++) c.update(0, 0.01);
  assert.equal(c.adj, -0.005);
});

test('AudioStreamPlayer: arrival times feed the jitter estimate; targets up to 3 s', async () => {
  globalThis.performance ??= { now: () => Date.now() };
  const { AudioStreamPlayer } = await import('../../src/js/media/audio-player.js');
  const a = new AudioStreamPlayer({ target: 0.12 });
  const planes = () => [new Float32Array(960)];
  // decoded in a burst, but it arrived smoothly: the real arrival keeps the jitter at 0
  for (let i = 0; i < 50; i++) a.push(planes(), { rate: 48000, ticks: i * 1800, arrival: 100 + i * 0.02 });
  assert.ok(a.jitter.spread < 1e-9, `spread ${a.jitter.spread}`);
  // arrival: false leaves the estimate alone
  const n = a.jitter.t.length;
  a.push(planes(), { rate: 48000, ticks: 50 * 1800, arrival: false });
  assert.equal(a.jitter.t.length, n);
  a.noteArrival(51 * 1800, 100 + 51 * 0.02 + 0.3);
  assert.ok(Math.abs(a.jitter.spread - 0.3) < 1e-6);
  const fixed = new AudioStreamPlayer({ target: 0.8, adaptive: false });
  assert.equal(fixed.minTarget, 0.8);
  fixed.setTarget(2); assert.equal(fixed.minTarget, 2);
  assert.equal(fixed.effTarget, 2);
});

test('AudioRing: a gap in the stream time is played as silence; a large skip is not', () => {
  const ring = new AudioRing({ inRate: 48000, outRate: 48000, target: 0.04 });
  const one = (n) => [new Float32Array(n).fill(1)];
  ring.push(one(960), 0);                 // 20 ms
  ring.push(one(960), 1800 + 900);        // 10 ms later than back to back
  assert.equal(ring.stats.gaps, 1);
  assert.ok(Math.abs(ring.stats.gapSeconds - 0.01) < 1e-9);
  assert.ok(Math.abs(ring.fill - 0.05) < 1e-9);
  ring.push(one(960), 2700 + 1800 + 1);   // 1 tick off: rounding, no gap
  assert.equal(ring.stats.gaps, 1);
  ring.push(one(960), 10 * 90000);        // 10 s ahead: a new timeline, played on
  assert.equal(ring.stats.gaps, 1);
  const off = new AudioRing({ fillGaps: false });
  off.push(one(960), 0);
  off.push(one(960), 9000);
  assert.equal(off.stats.gaps, 0);
  // the silence really is silent: read through it
  const r = new AudioRing({ inRate: 48000, outRate: 48000, target: 0.001 });
  r.push(one(480), 0);
  r.push(one(480), 900 + 900);            // 10 ms gap
  const out = [new Float32Array(1440)];
  r.read(out, 1440);
  assert.ok(out[0][100] > 0 && out[0][100] < 1);
  assert.equal(out[0][700], 0);
  assert.equal(out[0][1200], 1);
});

test('overrun splice and underrun tail have bounded sample steps', () => {
  const r = new AudioRing({ target: 0.04 });
  const out = [new Float32Array(128)];
  r.push([new Float32Array(4000).fill(0.8)], 0);
  r.read(out, 128); r.read(out, 128); r.read(out, 128);
  let last = out[0][127];
  r.push([new Float32Array(6000).fill(-0.8)], 7500);
  assert.ok(r.stats.drops > 0);
  for (let j = 0; j < 70; j++) {
    r.read(out, 128);
    for (const v of out[0]) {
      assert.ok(Math.abs(v - last) < 0.02, `sample step ${v - last}`);
      last = v;
    }
  }
  assert.ok(r.stats.underruns > 0);
  assert.equal(last, 0);
});

test('adaptive buffering respects a three-second user minimum', async () => {
  const { AudioStreamPlayer } = await import('../../src/js/media/audio-player.js');
  const p = new AudioStreamPlayer({ target: 3 });
  for (let i = 0; i < 300; i++) p.noteArrival(i * 1800, 100 + i * 0.02);
  p.setTarget(3);
  assert.equal(p.effTarget, 3);
});
