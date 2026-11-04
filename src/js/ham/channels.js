// Channel plans for the spectrum's channel strip: rows ("lanes") of
// selectable channels under the trace, fixed channels that span every lane
// (a beacon), and labelled regions. A plan is plain data; Spectrum draws it.
//
//   {
//     offsetHz: -8089.5e6,            // TX = RX + offset, or txHz: (ch) => hz
//     lanes: [{ label: '333 kS', sr: 333e3, width: 0.5e6, from, to, step } | { slots: [hz | {hz, ...}] }],
//     fixed: [{ hz, width, label, sr, rxOnly }],
//     regions: [{ from, to, label }],
//     meta: { name, version, date, source },  // optional, informational
//     select: 'rx+tx' | 'rx',         // whether a click hands out a TX frequency
//     occupancy: 'auto' | false | (ch) => boolean,
//     occupancyDb: 3,                 // 'auto': mean level this far above the noise floor
//     laneHeight: null,               // px; 14, or 18 on touch screens
//   }

/** "333 kS", "1.5 MS" from symbols per second. */
export function formatSymbolRate(sr) {
  if (sr == null) return '';
  return sr >= 1e6 ? `${+(sr / 1e6).toFixed(2)} MS` : `${+(sr / 1e3).toFixed(0)} kS`;
}

function channel(s, defaults) {
  const o = typeof s === 'number' ? { hz: s } : s;
  return {
    hz: o.hz,
    width: o.width ?? defaults.width,
    sr: o.sr ?? defaults.sr ?? null,
    label: o.label ?? defaults.label ?? null,
    rxOnly: !!(o.rxOnly ?? defaults.rxOnly),
    lane: defaults.lane,
    fixed: !!defaults.fixed,
    data: o.data,
  };
}

/** Validate and expand a plan; returns null for no plan. */
export function normalizePlan(p) {
  if (!p) return null;
  const lanes = (p.lanes || []).map((ln, i) => {
    let slots = ln.slots;
    if (!slots && ln.from != null && ln.step) {
      slots = [];
      for (let f = ln.from; f <= ln.to + ln.step * 1e-6; f += ln.step) slots.push(Math.round(f));
    }
    const width = ln.width ?? ln.step;
    return {
      label: ln.label ?? null,
      channels: (slots || []).map((s) => channel(s, { width, sr: ln.sr, label: ln.label, rxOnly: ln.rxOnly, lane: i })),
    };
  });
  const fixed = (p.fixed || []).map((s) => channel(s, { lane: null, fixed: true }));
  const regions = (p.regions || []).map((r) => ({ from: r.from, to: r.to, label: r.label ?? '' }));
  return {
    lanes,
    fixed,
    regions,
    all: [...fixed, ...lanes.flatMap((l) => l.channels)],
    offsetHz: p.offsetHz ?? null,
    txHz: typeof p.txHz === 'function' ? p.txHz : null,
    select: p.select === 'rx' ? 'rx' : 'rx+tx',
    occupancy: p.occupancy ?? 'auto',
    occupancyDb: p.occupancyDb ?? 3,
    laneHeight: p.laneHeight ?? null,
  };
}

/** The TX frequency for a channel, or null (receive only, or no offset given). */
export function txFor(plan, ch) {
  if (!ch || ch.rxOnly) return null;
  if (plan.txHz) return plan.txHz(ch);
  return typeof plan.offsetHz === 'number' ? ch.hz + plan.offsetHz : null;
}

const MHz = 1e6;

const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };

/**
 * Ready-made plans. Versioned keys are frozen and never change, so pin one
 * (e.g. qo100Wideband2021v3) when your layout must stay put. The unversioned
 * alias (qo100Wideband) follows the newest version. `meta` names the source.
 * The channel rows are a simplified operating aid; check the published
 * bandplan before transmitting.
 */
const qo100Wideband2021v3 = deepFreeze({
  meta: {
    name: 'QO-100 wideband transponder',
    version: '3',
    date: '2021-02-28',
    source: 'AMSAT-DL / BATC WB bandplan V3 (https://wiki.batc.org.uk/QO-100_WB_Bandplan)',
    note: 'Channel rows simplified from the BATC wideband spectrum monitor',
  },
  offsetHz: -8089.5 * MHz,
  fixed: [{ hz: 10491.5 * MHz, width: 1.8 * MHz, sr: 1.5e6, label: 'Beacon', rxOnly: true }],
  lanes: [
    { label: '1 MS', sr: 1e6, width: 1.5 * MHz, from: 10493.25 * MHz, to: 10496.25 * MHz, step: 1.5 * MHz },
    { label: '333 kS', sr: 333e3, from: 10492.75 * MHz, to: 10499.25 * MHz, step: 0.5 * MHz },
    { label: '125 kS', sr: 125e3, from: 10492.75 * MHz, to: 10499.25 * MHz, step: 0.25 * MHz },
  ],
  regions: [
    { from: 10490.5 * MHz, to: 10492.5 * MHz, label: 'Beacon' },
    { from: 10492.5 * MHz, to: 10497.0 * MHz, label: 'Wide & narrow' },
    { from: 10497.0 * MHz, to: 10499.5 * MHz, label: 'Narrow' },
  ],
});

export const bandplans = Object.freeze({
  qo100Wideband2021v3,
  qo100Wideband: qo100Wideband2021v3, // latest
});
