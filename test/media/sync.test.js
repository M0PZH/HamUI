import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncCore, AudioClock, ArrivalClock, VideoQueue, backlogPolicy, JitterEstimator, audioTarget } from '../../src/js/media/sync.js';
import { AudioRing } from '../../src/js/media/audio-core.js';
import { PTS_WRAP } from '../../src/js/media/pts.js';

const V = (pts, o = {}) => ({ pts, dts: o.dts ?? null, key: !!o.key, discontinuity: !!o.disc });
const A = (pts, o = {}) => ({ pts, discontinuity: !!o.disc });
const AF = 1800;  // 20 ms audio frame in ticks
const VF = 3600;  // 40 ms video frame

test('start: video begins at the first key frame, audio at the same stream time', () => {
  const s = new SyncCore();
  assert.equal(s.video(V(1000)).action, 'drop');             // not a key frame
  const a1 = s.audio(A(5000), AF);
  assert.equal(a1.action, 'hold');                           // audio waits for the picture
  s.audio(A(5000 + AF), AF);
  s.audio(A(5000 + 2 * AF), AF);
  const k = s.video(V(6000, { key: true }));
  assert.equal(k.action, 'decode');
  assert.equal(k.timeline, true);
  // held audio before the key frame's time is dropped, the rest released in order
  assert.deepEqual(k.release.map((h) => h.ticks), [5000 + AF, 5000 + 2 * AF].filter((t) => t >= 6000));
  assert.equal(s.audio(A(4000), AF).action, 'drop');         // earlier than the timeline start
  assert.equal(s.audio(A(5000 + 3 * AF), AF).action, 'decode');
  assert.equal(s.video(V(6000 + VF)).action, 'decode');
});

test('start with video before audio: audio of the timeline plays, earlier audio is dropped', () => {
  const s = new SyncCore();
  assert.equal(s.video(V(90000, { key: true })).timeline, true);
  assert.equal(s.audio(A(90000 - AF), AF).action, 'drop');
  assert.equal(s.audio(A(90000), AF).action, 'decode');
});

test('PTS wrap at 2^33 is not a new timeline', () => {
  const s = new SyncCore();
  let pts = PTS_WRAP - 5 * VF;
  s.video(V(pts, { key: true }));
  let last;
  for (let i = 0; i < 10; i++) {
    pts = (pts + VF) % PTS_WRAP;
    last = s.video(V(pts));
    assert.equal(last.action, 'decode');
    assert.equal(last.timeline, false);
    assert.equal(s.audio(A(pts), AF).action, 'decode');
  }
  assert.equal(last.ticks, PTS_WRAP + 5 * VF);                // unwrapped, continuous
  assert.equal(s.stats.timelines, 1);
});

test('video discontinuity (queue drop) restarts both streams at that key frame', () => {
  const s = new SyncCore();
  s.video(V(0, { key: true }));
  for (let t = 0; t < 20 * AF; t += AF) s.audio(A(t), AF);
  // the server dropped video up to the next key frame; audio frames in between stayed
  const k = s.video(V(45000, { key: true, disc: true }));
  assert.equal(k.timeline, true);
  assert.equal(s.stats.timelines, 2);
  assert.equal(s.audio(A(40000), AF).action, 'drop');        // before the key frame: dropped
  assert.equal(s.audio(A(45000), AF).action, 'decode');
});

test('a PTS jump over 1 s on audio holds audio until the next video key frame', () => {
  const s = new SyncCore();
  s.video(V(0, { key: true }));
  s.audio(A(0), AF);
  s.audio(A(AF), AF);
  const j = s.audio(A(10 * 90000), AF);                     // new acquisition: other encoder
  assert.equal(j.action, 'hold');
  assert.equal(s.video(V(VF)).action, 'drop');                // old picture stops; wait for key
  s.audio(A(10 * 90000 + AF), AF);
  const k = s.video(V(10 * 90000 + AF, { key: true }));
  assert.equal(k.timeline, true);
  assert.deepEqual(k.release.map((h) => h.ticks), [10 * 90000 + AF]);
});

test('audio discontinuity flag with a continuous PTS is only a gap', () => {
  const s = new SyncCore();
  s.video(V(0, { key: true }));
  s.audio(A(0), AF);
  const r = s.audio(A(AF * 10, { disc: true }), AF);          // 9 frames lost (< 1 s)
  assert.equal(r.action, 'decode');
  assert.equal(r.timeline, false);
  assert.equal(s.stats.audioGaps, 1);
  assert.equal(s.stats.timelines, 1);
});

test('audio-only service: the first audio frame starts the timeline; a jump restarts it', () => {
  const s = new SyncCore();
  s.hasVideo = false;
  const a = s.audio(A(1234), AF);
  assert.equal(a.action, 'decode');
  assert.equal(a.timeline, true);
  assert.equal(s.audio(A(1234 + AF), AF).timeline, false);
  const j = s.audio(A(1234 + 5 * 90000), AF);
  assert.equal(j.action, 'decode');
  assert.equal(j.timeline, true);
});

test('held audio is bounded while no key frame comes', () => {
  const s = new SyncCore({ holdAudio: 0.5 });
  for (let t = 0; t < 90000 * 2; t += AF) s.audio(A(t), AF);
  assert.ok(s.held.length <= Math.ceil((0.5 * 90000) / AF) + 1);
});

test('VideoQueue: newest due frame shown, older dropped, late by more than one interval dropped', () => {
  const q = new VideoQueue({ interval: 0.04 });
  for (let i = 0; i < 6; i++) q.push({ ticks: i * VF });
  let r = q.pick(2 * VF + 100);
  assert.equal(r.show.ticks, 2 * VF);
  assert.deepEqual(r.dropped.map((x) => x.ticks), [0, VF]);
  r = q.pick(2 * VF + 200);
  assert.equal(r.show, null);                                 // next frame not due: hold the picture
  r = q.pick(3 * VF + VF + 10);                               // frame 3 late by more than 1 interval, frame 4 due
  assert.equal(r.show.ticks, 4 * VF);
  r = q.pick(20 * VF);
  assert.equal(r.show, null);                                 // frame 5 is far too late
  assert.equal(q.stats.late, 4);
  const many = new VideoQueue({ max: 4 });
  for (let i = 0; i < 6; i++) many.push({ ticks: i * VF });
  assert.equal(many.length, 4);
  assert.equal(many.stats.overflow, 2);
});

test('AudioClock extrapolates between reports and stands still while not playing', () => {
  const c = new AudioClock();
  c.update({ ticks: 9000, playing: true, adj: 0.001, ctxTime: 10 });
  assert.ok(Math.abs(c.ticksAt(10.1) - (9000 + 0.1 * 90000 * 1.001)) < 1e-6);
  assert.equal(c.ticksAt(20) - 9000, 0.2 * 90000 * 1.001);    // limited extrapolation
  c.update({ ticks: 9000, playing: false, adj: 0, ctxTime: 10 });
  assert.equal(c.ticksAt(11), 9000);
});

test('backlog policy', () => {
  assert.equal(backlogPolicy(0, { key: false, disposable: true }), 'decode');
  assert.equal(backlogPolicy(4, { key: false, disposable: true }), 'skip');
  assert.equal(backlogPolicy(4, { key: false, disposable: false }), 'decode');
  assert.equal(backlogPolicy(9, { key: false, disposable: false }), 'skip-to-key');
  assert.equal(backlogPolicy(20, { key: true, disposable: false }), 'decode');
});

/** Deterministic pseudo-random numbers. */
function rng(seed) { let x = seed; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }

for (const ppm of [300, -300]) {
  test(`video-only: arrival clock at ${ppm} ppm with jitter for an hour keeps the margin and does not grow`, () => {
    const c = new ArrivalClock({ target: 0.08 });
    const random = rng(7);
    const fps = 25, frames = 3600 * fps;
    let minSlack = Infinity, maxDelayDrift = 0, d0 = null;
    for (let i = 0; i < frames; i++) {
      const sendTime = (i / fps) / (1 + ppm * 1e-6);          // transmitter clock fast/slow
      const now = 1000 + sendTime + 0.05 + random() * 0.03;     // network delay 50..80 ms
      const ticks = i * VF;
      const slack = c.arrive(ticks, now);
      if (i > 60 * fps) {
        minSlack = Math.min(minSlack, slack);
        // latency = presentation time - arrival time of a frame: must stay bounded
        const lat = c.timeOf(ticks) - now;
        if (d0 == null) d0 = lat;
        maxDelayDrift = Math.max(maxDelayDrift, Math.abs(lat - d0));
      }
    }
    assert.ok(minSlack > 0, `a frame arrived late after settling (${minSlack})`);
    assert.ok(maxDelayDrift < 0.06, `latency moved by ${maxDelayDrift.toFixed(3)} s`);
    assert.ok(c.stats.late <= 3, `late restarts ${c.stats.late}`);
  });
}

test('video-only: a stall followed by a burst trims the delay back instead of keeping it', () => {
  const c = new ArrivalClock({ target: 0.08 });
  let now = 0;
  for (let i = 0; i < 250; i++) { now = i * 0.04 + 0.05; c.arrive(i * VF, now); }
  const before = c.timeOf(250 * VF) - (250 * 0.04 + 0.05);
  // 2 s stall: the frames arrive late, all at once
  const t = 250 * 0.04 + 2.05;
  for (let i = 250; i < 300; i++) c.arrive(i * VF, t + (i - 250) * 0.001);
  assert.ok(c.stats.late >= 1);
  // live again: frames on time; the inflated delay is trimmed back
  for (let i = 300; i < 600; i++) c.arrive(i * VF, i * 0.04 + 0.05);
  const after = c.timeOf(599 * VF) - (599 * 0.04 + 0.05);
  assert.ok(after < before + 0.05, `margin before ${before.toFixed(3)} after ${after.toFixed(3)}`);
});

test('A/V with audio master: one hour at +300 ppm, picture stays within one frame of the sound, latency does not grow', () => {
  const OUT = 48000, Q = 128;
  const ring = new AudioRing({ target: 0.12 });
  const core = new SyncCore();
  const clock = new AudioClock();
  const vq = new VideoQueue();
  const random = rng(3);
  const ppm = 300, rate = 1 + ppm * 1e-6;
  const plane = new Float32Array(960);
  let nextA = 0, nextV = 0, nextRender = 0;
  let worstOffset = 0, lat0 = null, worstLatDrift = 0, shown = 0;
  const seconds = 3600;
  const steps = Math.round((seconds * OUT) / Q);
  for (let s = 0; s < steps; s++) {
    const t = (s * Q) / OUT;
    // transmitter: frames due at their stream time on its own clock, plus network jitter
    while (nextA / rate / 90000 + 0.04 <= t) {
      const r = core.audio(A(nextA), AF);
      for (const h of r.release) ring.push([plane], h.ticks);
      if (r.action === 'decode') ring.push([plane], r.ticks);
      nextA += AF;
    }
    while (nextV / rate / 90000 + 0.03 + random() * 0.02 <= t) {
      const r = core.video(V(nextV, { key: nextV % (25 * VF) === 0 }));
      if (r.timeline) ring.flush();
      for (const h of r.release) ring.push([plane], h.ticks);
      if (r.action === 'decode') vq.push({ ticks: r.ticks, arrival: t });
      nextV += VF;
    }
    ring.read([new Float32Array(Q)], Q);
    clock.update({ ...ring.report(), ctxTime: t + Q / OUT });
    if (t >= nextRender) {
      nextRender += 1 / 60;
      const pos = clock.ticksAt(t);
      if (pos != null && clock.running) {
        const { show } = vq.pick(pos);
        if (show && t > 60) {
          shown++;
          worstOffset = Math.max(worstOffset, Math.abs(show.ticks - pos) / 90);
          const lat = t - show.arrival;
          if (lat0 == null) lat0 = lat;
          worstLatDrift = Math.max(worstLatDrift, Math.abs(lat - lat0));
        }
      }
    }
  }
  assert.ok(shown > 3500 * 24, `frames shown ${shown}`);
  assert.ok(worstOffset <= 40 + 17, `A/V offset up to ${worstOffset.toFixed(1)} ms`);
  assert.ok(worstLatDrift < 0.06, `latency moved by ${(worstLatDrift * 1000).toFixed(0)} ms`);
  assert.equal(ring.stats.underruns, 0);
});

test('video-only: bursty arrival (400 ms bursts) settles without late frames or trims', () => {
  const c = new ArrivalClock({ target: 0.08 });
  const fps = 25;
  for (let i = 0; i < 25 * 600; i++) {
    const sent = i / fps;
    const now = 100 + Math.ceil(sent / 0.4) * 0.4 + 0.05;      // delivered at the end of each 400 ms burst
    c.arrive(i * VF, now);
    if (i === 25 * 60) { c.stats.late = 0; c.stats.trims = 0; }
  }
  assert.equal(c.stats.late, 0);
  assert.equal(c.stats.trims, 0);
});

test('jitter estimator and the adaptive audio target', () => {
  const j = new JitterEstimator({ window: 10 });
  for (let k = 0; k < 500; k++) {
    const t = k * 0.02;
    const arrival = Math.ceil(t / 0.4) * 0.4;                 // 400 ms bursts
    j.add(t - arrival, arrival);
  }
  assert.ok(j.spread > 0.37 && j.spread <= 0.4, `spread ${j.spread}`);
  assert.equal(audioTarget(0.12, j.spread), j.spread + 0.04);
  assert.equal(audioTarget(0.12, 0.01), 0.12);
  assert.equal(audioTarget(0.12, 3), 1.0);
  // old samples leave the window
  for (let k = 0; k < 600; k++) j.add(0, 20 + k * 0.02);
  assert.equal(j.spread, 0);
});
