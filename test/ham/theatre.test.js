import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFrames, pickFrame } from '../../src/js/components/video-stage.js';
import { settleSnap } from '../../src/js/components/bottom-sheet.js';

test('fitFrames: side by side in a wide space, stacked in a tall one', () => {
  const wide = fitFrames(1600, 500, 2, 16 / 9, 8);
  assert.equal(wide.cols, 2);
  assert.equal(wide.w, 796);
  const tall = fitFrames(800, 1000, 2, 16 / 9, 8);
  assert.equal(tall.cols, 1);
  assert.equal(tall.w, 800);
  assert.equal(tall.h, 450);
  const one = fitFrames(1000, 400, 1, 16 / 9, 8);
  assert.deepEqual([one.cols, one.w, one.h], [1, 711, 400]);
  assert.equal(fitFrames(0, 0, 2).w, 0);
  const bar = fitFrames(1000, 444, 1, 16 / 9, 8, 44);   // a 400 px picture + a 44 px bar
  assert.deepEqual([bar.w, bar.h], [711, 444]);
});

test('pickFrame: select, then a second press closes that picture; reopen a closed one', () => {
  let s = { visible: [true, true], selected: 0 };
  s = pickFrame(s, 1); assert.deepEqual(s, { visible: [true, true], selected: 1 });
  s = pickFrame(s, 1); assert.deepEqual(s, { visible: [true, false], selected: 0 });
  s = pickFrame(s, 0); assert.deepEqual(s, { visible: [true, false], selected: 0 }, 'the last picture stays');
  s = pickFrame(s, 1); assert.deepEqual(s, { visible: [true, true], selected: 1 });
});

test('settleSnap: nearest position, or on in the direction of a flick', () => {
  const hs = { hidden: 20, peek: 112, open: 400 };
  assert.equal(settleSnap(hs, 130), 'peek');
  assert.equal(settleSnap(hs, 300), 'open');
  assert.equal(settleSnap(hs, 30), 'hidden');
  assert.equal(settleSnap(hs, 130, 1.2), 'open');     // flicked up past peek
  assert.equal(settleSnap(hs, 100, -1.2), 'hidden');  // flicked down below peek
  assert.equal(settleSnap(hs, 112, 0.2), 'peek');     // slow: nearest
});
