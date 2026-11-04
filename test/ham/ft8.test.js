import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFt8 } from '../../src/js/ham/decodes.js';
import { bandplans, normalizePlan, txFor } from '../../src/js/ham/channels.js';

test('parseFt8: CQ, directed, reports, acks', () => {
  assert.deepEqual(
    { ...parseFt8('CQ IZ1AAA JN45') },
    { cq: true, tag: null, to: null, from: 'IZ1AAA', grid: 'JN45', report: null, roger: false, ack: null, free: false });
  const dx = parseFt8('CQ DX JA1ABC PM95');
  assert.equal(dx.tag, 'DX'); assert.equal(dx.from, 'JA1ABC'); assert.equal(dx.grid, 'PM95');
  assert.equal(parseFt8('CQ POTA K1ABC FN42').tag, 'POTA');
  const r = parseFt8('IZ1AAA M0PZH R-12');
  assert.equal(r.to, 'IZ1AAA'); assert.equal(r.from, 'M0PZH'); assert.equal(r.report, -12); assert.equal(r.roger, true);
  assert.equal(parseFt8('M0PZH SP9XYZ +05').report, 5);
  assert.equal(parseFt8('F5AAA G0XYZ RR73').ack, 'RR73');
  assert.equal(parseFt8('F5AAA G0XYZ RR73').grid, null);
  assert.equal(parseFt8('F5AAA G0XYZ 73').ack, '73');
  assert.equal(parseFt8('M0PZH/P DL0ABC JO62').to, 'M0PZH/P');
  assert.equal(parseFt8('<PJ4/K1ABC> M0PZH IO91').to, '<PJ4/K1ABC>');
  assert.equal(parseFt8('TNX 73 GL').free, true);
});

test('bandplans: versioned plans are frozen, the alias is the latest', () => {
  const v3 = bandplans.qo100Wideband2021v3;
  assert.equal(bandplans.qo100Wideband, v3);
  assert.equal(v3.meta.version, '3');
  assert.ok(Object.isFrozen(v3) && Object.isFrozen(v3.lanes[0]));
  assert.throws(() => { 'use strict'; v3.lanes[0].step = 1; });
  const p = normalizePlan(v3);
  const ch = p.all.find((c) => c.hz === 10494.75e6 && c.lane === 1);
  assert.equal(txFor(p, ch), 2405.25e6);
  assert.equal(txFor(p, p.fixed[0]), null);
});
