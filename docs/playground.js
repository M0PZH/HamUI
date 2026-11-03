// HamUI playground: edit HTML + JS, run it in the preview pane.
import HamUI from '../src/js/index.js';

const PRESETS = {
  panadapter: {
    label: 'Panadapter + simulator',
    html: `<div class="ham-panel ham-panel-clip">
  <div class="ham-scope-bar">
    <span class="ham-label">20m FT8</span>
    <span class="ham-spacer"></span>
    <span class="ham-scope-span" id="span">12.0 kHz</span>
  </div>
  <div id="pan" data-ham="panadapter"
       data-start-hz="14069500" data-span-hz="12000"
       data-min-db="-128" data-max-db="-60"></div>
  <div class="ham-panel-foot" style="justify-content: flex-start">
    <span class="ham-mono ham-muted" id="log">Click the spectrum to tune, pinch to zoom</span>
  </div>
</div>`,
    js: `HamUI.init(root);
const pan = HamUI.getInstance('#pan');
pan.setDial(14074000);
pan.setPassband(HamUI.passbandFor('USB', 2900));
pan.waterfall.setColormap('viridis');

pan.on('tune', (e) => {
  root.querySelector('#log').textContent = 'tune → ' + HamUI.format.formatHz(e.detail.hz);
});
pan.on('viewchange', (e) => {
  root.querySelector('#span').textContent = HamUI.format.formatSpan(e.detail.span);
});

// Fill the waterfall history, then push a frame every 50 ms
const t0 = Date.now();
for (let i = 256; i > 0; i--) pan.waterfall.push(sim.next(t0 - i * 50), sim.range);
every(50, () => pan.push(sim.next(), sim.range));`,
  },
  meters: {
    label: 'Meters',
    html: `<div class="ham-panel ham-panel-body ham-meters" style="max-width: 440px">
  <div id="s" data-ham="meter" data-type="s"></div>
  <div id="p" data-ham="meter" data-type="power" data-max="100"></div>
  <div id="swr" data-ham="meter" data-type="swr"></div>
  <div id="alc" data-ham="meter" data-type="alc"></div>
  <div id="v" data-ham="meter" data-type="custom" data-label="VDD"
       data-min="10" data-max="16" data-unit="V" data-segments="0"></div>
</div>`,
    js: `HamUI.init(root);
const [s, p, swr, alc, v] = ['#s', '#p', '#swr', '#alc', '#v'].map(HamUI.getInstance);
let dbm = -90;

every(120, () => {
  dbm = Math.max(-120, Math.min(-40, dbm + (Math.random() - 0.5) * 10));
  s.set(dbm);
  p.set(45 + Math.random() * 8);
  swr.set(1.2 + Math.random() * 0.2);
  alc.set(20 + Math.random() * 20);
  v.set(13.6 + Math.random() * 0.3);
});`,
  },
  vfo: {
    label: 'VFO + band / mode',
    html: `<div class="ham-panel ham-panel-body ham-stack" style="--ham-gap: 16px">
  <div class="ham-vfo">
    <span class="ham-vfo-tag is-active">A</span>
    <div id="vfo" data-ham="frequency" data-value="14074000" data-size="xl" data-unit="MHz"></div>
  </div>
  <div id="band" data-ham="band-selector" data-value="20m"></div>
  <div id="mode" data-ham="mode-selector" data-value="USB"></div>
  <div class="ham-mono ham-muted ham-text-sm" id="log">Scroll or drag a digit to tune</div>
</div>`,
    js: `HamUI.init(root);
const vfo = HamUI.getInstance('#vfo');
const band = HamUI.getInstance('#band');
const mode = HamUI.getInstance('#mode');
const log = (t) => (root.querySelector('#log').textContent = t);

vfo.on('change', (e) => { band.follow(e.detail.hz); log(e.detail.hz + ' Hz'); });
band.on('change', (e) => {
  vfo.set(e.detail.band.dial, { silent: true });
  mode.select(HamUI.defaultMode(e.detail.band.dial));
  log(e.detail.value + ' · ' + HamUI.format.formatHz(e.detail.band.dial));
});
mode.on('change', (e) => log('mode ' + e.detail.value + ' · passband ' + HamUI.passbandFor(e.detail.value)));`,
  },
  station: {
    label: 'Knobs + PTT + status bar',
    html: `<div class="ham-panel ham-panel-clip">
  <div class="ham-statusbar">
    <span id="trx" data-ham="trx"></span>
    <span class="ham-kv">Call <b>N0CALL</b></span>
    <span class="ham-spacer"></span>
    <span class="ham-kv">UTC <b><time data-ham="clock"></time></b></span>
  </div>
  <div class="ham-panel-body ham-cluster" style="--ham-gap: 20px">
    <div data-ham="knob" data-label="AF" data-value="40"></div>
    <div id="pwr" data-ham="knob" data-label="PWR" data-min="5" data-max="100" data-value="50" data-unit="W"></div>
    <div id="m" data-ham="meter" data-type="power" data-off style="flex: 1; min-width: 220px"></div>
    <button id="ptt" data-ham="ptt" class="ham-btn-lg"></button>
  </div>
</div>`,
    js: `HamUI.init(root);
const trx = HamUI.getInstance('#trx');
const pwr = HamUI.getInstance('#pwr');
const meter = HamUI.getInstance('#m');
let tx = false;

HamUI.getInstance('#ptt').on('ptt', (e) => {
  tx = e.detail.on;
  trx.set(tx ? 'tx' : 'rx');
  meter.setOff(!tx);
});
every(80, () => { if (tx) meter.set(pwr.get() * (0.9 + Math.random() * 0.1)); });`,
  },
  scratch: {
    label: 'From scratch (plain JS)',
    html: `<div id="spec" style="height: 220px"></div>`,
    js: `// No data attributes: construct the component directly
const spec = new HamUI.Spectrum(root.querySelector('#spec'), {
  startHz: sim.startHz, spanHz: sim.spanHz,
  minDb: -130, maxDb: -60, averaging: 0.2,
});
spec.setDial(14074000);
spec.setMarkers([{ hz: 14078000, color: 'warn', dashed: true, label: 'JS8' }]);
every(50, () => spec.update(sim.next()));`,
  },
};

const $ = (s) => document.querySelector(s);
const htmlEl = $('#html'), jsEl = $('#js'), preview = $('#preview'), errorEl = $('#error'), statusEl = $('#status');

HamUI.init();

/* ---- editor niceties: Tab inserts spaces, Ctrl/⌘+Enter runs ---- */
for (const ta of [htmlEl, jsEl]) {
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = ta;
      ta.value = value.slice(0, a) + '  ' + value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + 2;
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  });
  ta.addEventListener('input', () => { clearTimeout(ta._t); ta._t = setTimeout(run, 700); });
}

/* ---- run ---- */
let timers = [];
const sim = new HamUI.SignalSimulator({ startHz: 14069500, spanHz: 12000, bins: 2048 });

function cleanup() {
  for (const t of timers) clearInterval(t);
  timers = [];
  for (const el of preview.querySelectorAll('*')) HamUI.getInstance(el)?.destroy();
  preview.replaceChildren();
}

function run() {
  clearTimeout(htmlEl._t); clearTimeout(jsEl._t);
  cleanup();
  errorEl.hidden = true;
  preview.innerHTML = htmlEl.value;
  const every = (ms, fn) => { const id = setInterval(() => { try { fn(); } catch (err) { showError(err); clearInterval(id); } }, ms); timers.push(id); return id; };
  try {
    // user code from this page's own editor, run on purpose
    new Function('HamUI', 'root', 'sim', 'every', `"use strict";\n${jsEl.value}`)(HamUI, preview, sim, every);
    statusEl.textContent = 'Ran';
  } catch (err) {
    showError(err);
  }
  saveDraft();
}

function showError(err) {
  errorEl.hidden = false;
  errorEl.textContent = String(err && err.stack ? err.message : err);
  statusEl.textContent = 'Error';
}

/* ---- presets, drafts, sharing ---- */
const presetSel = $('#preset');
presetSel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');

function load(key) {
  clearTimeout(htmlEl._t); clearTimeout(jsEl._t); // drop pending auto-runs of the old code
  const p = PRESETS[key] || PRESETS.panadapter;
  htmlEl.value = p.html;
  jsEl.value = p.js;
  run();
}

const b64 = {
  enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

function saveDraft() {
  try { localStorage.setItem('hamui-playground-v2', JSON.stringify({ preset: presetSel.value, html: htmlEl.value, js: jsEl.value })); } catch { /* storage unavailable */ }
}

presetSel.onchange = () => load(presetSel.value);
$('#resetBtn').onclick = () => load(presetSel.value);
$('#runBtn').onclick = run;
$('#shareBtn').onclick = async () => {
  const url = `${location.href.split('#')[0]}#code=${b64.enc(JSON.stringify({ html: htmlEl.value, js: jsEl.value }))}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); HamUI.toast({ title: 'Link copied', tone: 'success', timeout: 2000 }); }
  catch { HamUI.toast({ title: 'Link is in the address bar', body: 'The browser blocked clipboard access; copy it from the address bar', tone: 'info' }); }
};

HamUI.getInstance('#previewTheme').on('change', (e) => { preview.dataset.theme = e.detail.value; });

/* ---- initial content: shared link > draft > first preset ---- */
(function start() {
  const m = location.hash.match(/^#code=(.+)$/);
  if (m) {
    try {
      const { html, js } = JSON.parse(b64.dec(m[1]));
      htmlEl.value = html; jsEl.value = js; run();
      return;
    } catch { /* bad link, fall through */ }
  }
  try {
    const d = JSON.parse(localStorage.getItem('hamui-playground-v2') || 'null');
    if (d && d.html != null) {
      if (PRESETS[d.preset]) presetSel.value = d.preset;
      htmlEl.value = d.html; jsEl.value = d.js; run();
      return;
    }
  } catch { /* ignore */ }
  load('panadapter');
})();
