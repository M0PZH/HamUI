import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFt8, formatDt, revealScroll } from '../../src/js/ham/decodes.js';
import { bandplans, normalizePlan, txFor, regionAt } from '../../src/js/ham/channels.js';

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

test('formatDt: one decimal, no negative zero, empty for missing values', () => {
  assert.equal(formatDt(0.2), '0.2');
  assert.equal(formatDt(-0.04), '0.0');
  assert.equal(formatDt(-0), '0.0');
  assert.equal(formatDt(-0.26), '-0.3');
  assert.equal(formatDt(1.25), '1.3');
  assert.equal(formatDt('0.7'), '0.7');
  assert.equal(formatDt(null), '');
  assert.equal(formatDt(undefined), '');
  assert.equal(formatDt(''), '');
  assert.equal(formatDt('x'), '');
});

test('revealScroll: brings a row under the sticky header or to the bottom, else leaves it', () => {
  // view 100 px, header 20 px, scrolled to 200: rows 220..300 are visible
  assert.equal(revealScroll(200, 100, 240, 20, 20), 200);
  assert.equal(revealScroll(200, 100, 210, 20, 20), 190);   // under the header
  assert.equal(revealScroll(200, 100, 50, 20, 20), 30);     // above
  assert.equal(revealScroll(200, 100, 290, 20, 20), 210);   // cut at the bottom
  assert.equal(revealScroll(200, 100, 600, 20, 20), 520);   // below
  assert.equal(revealScroll(0, 100, 10, 20, 20), 0);        // never above the top
  assert.equal(revealScroll(0, 50, 100, 80, 20), 80);       // taller than the view: its top
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

test('bandplans: QO-100 narrowband', () => {
  const nb = bandplans.qo100Narrowband2020;
  assert.equal(bandplans.qo100Narrowband, nb);
  assert.ok(Object.isFrozen(nb.regions[0].data));
  const p = normalizePlan(nb);
  assert.equal(p.select, 'rx');
  assert.equal(p.all.length, 6);
  // segments tile 10489.500 .. 10490.000 without gaps
  for (let i = 1; i < nb.regions.length; i++) assert.equal(nb.regions[i].from, nb.regions[i - 1].to);
  assert.equal(regionAt(nb, 10489.600e6).label, 'Digi 2.7 kHz');
  assert.equal(regionAt(p, 10489.520e6).data.mode, 'cw');
  assert.equal(regionAt(nb, 10490.5e6), null);
  const emerg = p.fixed.find((c) => c.label === 'Emergency');
  assert.equal(txFor(p, emerg), 2400.360e6);
});

test('normalizePlan: narrow fixed channel options', () => {
  assert.equal(normalizePlan(bandplans.qo100Narrowband).fixedMinPx, 8);
  assert.equal(normalizePlan({ ...bandplans.qo100Narrowband, fixedStyle: 'pin' }).fixedStyle, 'pin');
  assert.equal(normalizePlan({ fixedStyle: 'x' }).fixedStyle, 'box');
});
