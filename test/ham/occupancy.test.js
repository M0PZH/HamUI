import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spectrum } from '../../src/js/ham/spectrum.js';
import { normalizePlan } from '../../src/js/ham/channels.js';

test('channel occupancy uses independent Schmitt states above the noise floor', () => {
  const s = { plan: normalizePlan({}), options: {}, _busy: new Map(), _frame: 0, _floorFrame: -1,
    dataStart: 0, dataSpan: 100, avg: new Float32Array(100) };
  const a = { hz: 25, width: 10 }, b = { hz: 75, width: 10 };
  const frame = excess => { s.avg.fill(-100); s.avg.fill(-100 + excess, 20, 31); s._frame++; };
  for (const [excess, busy] of [[2.9,false],[3.2,true],[2.8,true],[1.2,true],[0.9,false],[2.8,false],[3.1,true]]) {
    frame(excess);
    assert.equal(Spectrum.prototype._isBusy.call(s, a), busy, `excess ${excess}`);
    assert.equal(Spectrum.prototype._isBusy.call(s, b), false);
  }
  s.options = { occupancyDb: 8, occupancyHysteresisDb: 0 };
  frame(7); assert.equal(Spectrum.prototype._isBusy.call(s, a), false);
  frame(9); assert.equal(Spectrum.prototype._isBusy.call(s, a), true);
  frame(7); assert.equal(Spectrum.prototype._isBusy.call(s, a), false);
});

test('custom occupancy callbacks and disabled plans keep their meaning', () => {
  assert.equal(Spectrum.prototype._isBusy.call({ plan: { occupancy: false } }, {}), null);
  assert.equal(Spectrum.prototype._isBusy.call({ plan: { occupancy: () => true } }, {}), true);
});
