import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachScopeGestures } from '../../src/js/core/gestures.js';

test('scope hover is cleared for touch, including release and cancellation', () => {
  const target = new EventTarget();
  target.style = {};
  target.classList = { add() {}, remove() {} };
  let hover = false, pans = 0;
  const detach = attachScopeGestures(target, { hover: () => { hover = true; }, leave: () => { hover = false; }, pan: () => pans++ });
  const send = (name, type, x = 10) => {
    const e = new Event(name);
    Object.assign(e, { pointerType: type, pointerId: 1, button: 0, clientX: x, clientY: 10 });
    target.dispatchEvent(e);
  };
  send('pointermove', 'mouse'); assert.equal(hover, true);
  send('pointerdown', 'touch'); assert.equal(hover, false);
  send('pointermove', 'touch', 80); assert.equal(hover, false);
  assert.equal(pans, 1, 'touch still pans');
  send('pointerup', 'touch', 80); assert.equal(hover, false);
  send('pointermove', 'mouse'); assert.equal(hover, true);
  send('pointerdown', 'touch'); send('pointercancel', 'touch'); assert.equal(hover, false);
  send('pointermove', 'mouse'); assert.equal(hover, true);
  send('pointerleave', 'mouse'); assert.equal(hover, false);
  detach();
});
