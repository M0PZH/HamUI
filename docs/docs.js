// Docs page wiring. Examples are plain HTML; their source is shown under
// each preview, captured before HamUI.init() changes the DOM.
import HamUI from '../src/js/index.js';
import { AudioStreamPlayer } from '../src/js/media/index.js';

function dedent(s) {
  const lines = s.replace(/^\n+|\s+$/g, '').split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(ind)).join('\n');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const ex of document.querySelectorAll('.doc-example')) {
  if (ex.hasAttribute('data-no-code') || ex.querySelector(':scope > pre')) continue;
  const preview = ex.querySelector('.doc-preview');
  const pre = document.createElement('pre');
  pre.innerHTML = `<code>${esc(dedent(preview.innerHTML))}</code>`;
  ex.appendChild(pre);
}

HamUI.init();

/* theme switch */
const themeSeg = HamUI.getInstance('#themeSeg');
themeSeg.select(HamUI.theme.get(), { silent: true });
themeSeg.on('change', (e) => HamUI.theme.set(e.detail.value));

/* swatches */
const SW = [['bg', 'Background'], ['surface', 'Panel'], ['surface-2', 'Control'], ['inset', 'Inset / canvas'], ['border', 'Border'], ['border-strong', 'Strong border'],
  ['fg', 'Text'], ['fg-muted', 'Muted text'], ['fg-faint', 'Faint text'], ['accent', 'Accent'], ['rx', 'RX / OK'], ['tx', 'TX / error'], ['warn', 'Warning']];
document.querySelector('#swatches').innerHTML = SW.map(([k, n]) => `<div class="doc-swatch"><i style="background:var(--ham-${k})"></i>${n}<code>--ham-${k}</code></div>`).join('');

/* event log helper */
function log(sel, text) { const el = document.querySelector(sel); if (el) el.textContent = text; }

/* toast / modal demos */
document.querySelector('#toastInfo').onclick = () => HamUI.toast({ title: 'Connected to IC-7300', body: 'CI-V address 94h · 19200 bps', tone: 'success' });
document.querySelector('#toastWarn').onclick = () => HamUI.toast({ title: 'High SWR', body: 'SWR 2.4:1, power limited to 30 W', tone: 'warn' });
document.querySelector('#toastErr').onclick = () => HamUI.toast({ title: 'Serial port lost', body: '/dev/ttyUSB0 is not responding', tone: 'error', timeout: 0 });

/* frequency display */
const fd = HamUI.getInstance('#docFreq');
fd.on('change', (e) => log('#docFreqLog', `ham:change → ${e.detail.hz} Hz (${e.detail.source})`));

/* knobs */
document.querySelectorAll('#docKnobs [data-ham="knob"]').forEach((k) =>
  HamUI.getInstance(k).on('change', (e) => log('#docKnobLog', `${k.dataset.label} = ${e.detail.value}`)));

/* selectors */
HamUI.getInstance('#docBand').on('change', (e) => log('#docBandLog', `${e.detail.value} · ${(e.detail.band.dial / 1e6).toFixed(3)} MHz`));
HamUI.getInstance('#docMode').on('change', (e) => log('#docModeLog', `mode = ${e.detail.value} · passband ${HamUI.passbandFor(e.detail.value).join(' … ')} Hz`));

/* ptt */
const trx = HamUI.getInstance('#docTrx');
HamUI.getInstance('#docPtt').on('ptt', (e) => trx.set(e.detail.on ? 'tx' : 'rx'));

/* live meters */
const sMeter = HamUI.getInstance('#docS');
const pMeter = HamUI.getInstance('#docP');
const swr = HamUI.getInstance('#docSwr');
const alc = HamUI.getInstance('#docAlc');
let level = -90;
setInterval(() => {
  level += (Math.random() - 0.5) * 8; level = Math.max(-115, Math.min(-50, level));
  sMeter.set(level);
  const w = 40 + Math.random() * 10; pMeter.set(w);
  swr.set(1.25 + Math.random() * 0.1);
  alc.set(25 + Math.random() * 15);
}, 120);

/* DVB-S2 */
const dvb = new HamUI.DvbS2Simulator({ modcod: '8PSK 3/4', merDb: 10.5 });
const docIq = HamUI.getInstance('#docIq'), docMer = HamUI.getInstance('#docMer');
const docLock = HamUI.getInstance('#docLock'), docTrend = HamUI.getInstance('#docTrend');
function setModcod(name) {
  const m = HamUI.dvbs2.getModcod(name);
  dvb.setModcod(name);
  dvb.merDb = m.esn0 + 2.5;
  docIq.setModulation(m.modulation, m.rate); docIq.clear();
  docMer.setModcod(m);
  docTrend.clear();
  docTrend.setThresholds([{ value: m.esn0, color: 'warn', label: `QEF ${m.esn0.toFixed(2)} dB` }]);
  log('#docMc', m.name); log('#docTh', `${m.esn0.toFixed(2)} dB`);
  log('#docBr', `≈ ${(HamUI.dvbs2.bitrate(333000, m) / 1000).toFixed(0)} kbit/s`);
}
setModcod('8PSK 3/4');
document.querySelector('#docModcod').onchange = (e) => setModcod(e.target.value);
document.querySelector('#docReacq').onclick = () => { dvb.acquire(); docIq.clear(); };
let dvbTick = 0;
setInterval(() => {
  const st = dvb.stage();
  docLock.set(st);
  docIq.push(dvb.next());
  const m = dvb.currentMer() + (Math.random() - 0.5) * 0.2;
  if (st >= 2) { docMer.setOff(false); docMer.set(m); } else docMer.setOff(true, '—');
  if (++dvbTick % 4 === 0 && st >= 2) docTrend.push(m);
}, 50);

/* scopes fed by the simulator */
const sim = new HamUI.SignalSimulator({ startHz: 14069500, spanHz: 12000, bins: 2048 });
const range = sim.range;
const dial = 14074000;
const pb = HamUI.passbandFor('USB', 2900);

const spec = HamUI.getInstance('#docSpectrum');
const wf = HamUI.getInstance('#docWaterfall');
const pan = HamUI.getInstance('#docPan');
for (const s of [spec, wf, pan]) { s.setDial(dial); s.setPassband(pb); }
spec.setMarkers([{ hz: 14078000, color: 'warn', dashed: true, label: 'JS8' }]);
pan.on('tune', (e) => log('#docPanLog', `ham:tune → ${(e.detail.hz / 1e6).toFixed(5)} MHz`));
pan.on('viewchange', (e) => log('#docPanSpan', HamUI.format.formatSpan(e.detail.span)));
spec.on('tune', (e) => log('#docSpecLog', `ham:tune → ${(e.detail.hz / 1e6).toFixed(5)} MHz`));

document.querySelector('#panZoomIn').onclick = () => pan.view.zoomAt(1.6, pan.view.center);
document.querySelector('#panZoomOut').onclick = () => pan.view.zoomAt(1 / 1.6, pan.view.center);
document.querySelector('#panReset').onclick = () => pan.view.reset();
HamUI.getInstance('#wfMap').on('change', (e) => wf.setColormap(e.detail.value));

// prefill history so waterfalls are not empty at first paint
const now = Date.now();
for (let i = 256; i > 0; i--) { const f = sim.next(now - i * 50); wf.push(f, range); pan.waterfall.push(f, range); }

/* channel strip: a QO-100 wideband transponder with a few carriers */
const chan = HamUI.getInstance('#docChannels');
chan.setChannels(HamUI.bandplans.qo100Wideband);
const QO = { startHz: 10490e6, spanHz: 10e6 }, QO_BINS = 1024;
const carriers = [[10491.5e6, 1.5e6, 11], [10493.25e6, 1e6, 12], [10494.75e6, 333e3, 8], [10496e6, 500e3, 7], [10499e6, 125e3, 5]];
const qoFrame = new Float32Array(QO_BINS);
function qoSpectrum() {
  for (let i = 0; i < QO_BINS; i++) {
    const f = QO.startHz + (i / QO_BINS) * QO.spanHz;
    let p = 10 ** (-10 + 0.12 * Math.sin(i / 150));
    for (const [hz, sr, db] of carriers) {
      const d = Math.abs(f - hz), half = sr * 0.6, edge = sr * 0.1;
      if (d < half) p += 10 ** ((-100 + db) / 10) * (d < half - 2 * edge ? 1 : 0.5 * (1 + Math.cos(Math.PI * (d - half + 2 * edge) / (2 * edge))));
    }
    qoFrame[i] = 10 * Math.log10(p) + 10 * Math.log10(-Math.log(Math.random() || 1e-9)) * 0.35;
  }
  return qoFrame;
}
const mhz = (hz) => (hz / 1e6).toFixed(3);
chan.on('channel', (e) => {
  const d = e.detail;
  log('#docChanLog', `ham:channel → RX ${mhz(d.rxHz)} MHz · TX ${d.txHz ? `${mhz(d.txHz)} MHz` : '—'}${d.sr ? ` · ${HamUI.formatSymbolRate(d.sr)}/s` : ''}${d.rxOnly ? ' · receive only' : ''}`);
});
chan.setDial(10494.75e6);
chan.selectChannel(10494.75e6, { sr: 333e3 });
let qoTick = 0;

setInterval(() => {
  const f = sim.next();
  if (++qoTick % 3 === 0) chan.update(qoSpectrum(), QO);
  spec.update(f, range);
  wf.push(f, range);
  pan.push(f, range);
}, 50);

/* video panel: a moving test card, sound from a quiet test tone through AudioStreamPlayer */
{
  const vp = new HamUI.VideoPanel('#docVideo', { label: 'Example video', volume: 0.4 });
  vp.setTitle('N0CALL', 'H.265 · 1280×720 · 25 fps');
  const audio = new AudioStreamPlayer({ target: 0.12 });
  audio.volume = vp.volume; audio.muted = vp.muted;
  vp.setSoundBlocked(true);
  const startSound = () => audio.start().then(() => vp.setSoundBlocked(audio.blocked)).catch((e) => vp.setMessage(e.message, 'error'));
  vp.on('unmute', startSound);
  vp.on('volume', (e) => { audio.volume = e.detail.volume; audio.muted = e.detail.muted; if (!e.detail.muted && audio.blocked) startSound(); });
  // the tone: 12 kHz PCM in 20 ms chunks, as a WebSocket stream would deliver it
  let ph = 0;
  setInterval(() => {
    const n = 240, buf = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const env = 0.5 + 0.5 * Math.sin(ph / 9000);
      buf[i] = 1800 * env * (Math.sin(ph * 2 * Math.PI * 440 / 12000) + 0.5 * Math.sin(ph * 2 * Math.PI * 660 / 12000));
      ph++;
    }
    if (audio.running) audio.push(buf, { rate: 12000 });
  }, 20);
  const cv = vp.canvas, ctx = cv.getContext('2d');
  cv.width = 640; cv.height = 360;
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const t0 = performance.now();
  const draw = (now) => {
    const W = cv.width, H = cv.height, t = (now - t0) / 1000;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1d3a52'); g.addColorStop(1, '#0d1a26');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const bw = (W * 0.6) / bars.length, bx = W * 0.2, by = H * 0.24, bh = H * 0.36;
    bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(bx + i * bw, by, bw + 1, bh); });
    for (let i = 0; i < 6; i++) { ctx.fillStyle = `rgb(${i * 50},${i * 50},${i * 50})`; ctx.fillRect(bx + i * W * 0.1, by + bh, W * 0.1, H * 0.08); }
    ctx.fillStyle = '#fff'; ctx.font = '600 24px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N0CALL  ·  IO91', W / 2, by + bh + H * 0.2);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect((Math.sin(t * 1.3) * 0.5 + 0.5) * W - 2, H * 0.86, 4, H * 0.06);
    vp.setLevel(audio.level());
    vp.setTime(t);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  setInterval(() => {
    const st = audio.stats();
    const ms = (v) => (v == null ? null : `${Math.round(v * 1000)} ms`);
    vp.setStats([
      ['Video', '312 kbit/s'],
      ['Audio', st.running ? '12 kHz PCM' : 'off'],
      ['Audio buffer', ms(st.fill)],
      ['Target', ms(st.target)],
      ['Jitter', ms(st.jitter)],
      ['Clock drift', st.ppm == null ? null : `${st.ppm >= 0 ? '+' : ''}${st.ppm.toFixed(0)} ppm`],
      ['Underruns', st.underruns, st.underruns ? 'warn' : ''],
    ]);
  }, 500);
}

/* decode list: a simulated FT8 band */
{
  const dl = HamUI.getInstance('#docDecodes');
  const calls = ['EA4ZZZ IN80', 'DL0ABC JO62', 'F5AAA JN18', 'JA1ABC PM95', 'IZ1AAA JN45', 'SP9XYZ KN09', 'OK1RR JN79', 'K1ABC FN42', 'OH2XX KP20', 'G0XYZ IO91'];
  const info = { EA4ZZZ: 'Spain', DL0ABC: 'Germany', F5AAA: 'France', JA1ABC: 'Japan', IZ1AAA: 'Italy', SP9XYZ: 'Poland', OK1RR: 'Czechia', K1ABC: 'USA', OH2XX: 'Finland', G0XYZ: 'England' };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const msg = () => {
    const [c, grid] = pick(calls).split(' ');
    const r = Math.random();
    if (r < 0.3) return { message: `CQ ${Math.random() < 0.2 ? 'DX ' : ''}${c} ${grid}`, call: c };
    if (r < 0.42) return { message: `M0PZH ${c} ${Math.random() < 0.5 ? grid : `R-${10 + Math.floor(Math.random() * 9)}`}`, call: c };
    const [o] = pick(calls).split(' ');
    return { message: `${o} ${c} ${pick([grid, '-11', 'R-07', 'RR73', '73'])}`, call: c };
  };
  const cycle = (when) => {
    const t = new Date(Math.floor(when / 15000) * 15000);
    const odd = Math.floor(when / 15000) % 2 === 1;
    if (odd && Math.random() < 0.5) return [{ time: t, tx: true, freq: 1500, message: 'CQ M0PZH IO91' }];
    return Array.from({ length: 3 + Math.floor(Math.random() * 5) }, () => {
      const m = msg();
      return { time: t, snr: Math.round(-24 + Math.random() * 30), dt: Math.round((Math.random() - 0.3) * 10) / 10, freq: 200 + Math.round(Math.random() * 2600), message: m.message, info: info[m.call] };
    }).sort((a, b) => a.freq - b.freq);
  };
  const now = Date.now();
  for (let k = 8; k > 0; k--) dl.push(cycle(now - k * 15000));
  setInterval(() => dl.push(cycle(Date.now() - 1000)), 15000);
  dl.on('select', (e) => {
    const d = e.detail;
    log('#docDecodesLog', `ham:select → ${d.message} · from ${d.from ?? '—'}${d.grid ? ` · ${d.grid}` : ''}${d.report != null ? ` · ${d.report} dB` : ''} · ${d.freq} Hz`);
  });
}
