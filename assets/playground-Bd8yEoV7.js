import{H as d}from"./index-D-fzwP5k.js";/* empty css             */const p={panadapter:{label:"Panadapter + simulator",html:`<div class="ham-panel ham-panel-clip">
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
</div>`,js:`HamUI.init(root);
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
every(50, () => pan.push(sim.next(), sim.range));`},meters:{label:"Meters",html:`<div class="ham-panel ham-panel-body ham-meters" style="max-width: 440px">
  <div id="s" data-ham="meter" data-type="s"></div>
  <div id="p" data-ham="meter" data-type="power" data-max="100"></div>
  <div id="swr" data-ham="meter" data-type="swr"></div>
  <div id="alc" data-ham="meter" data-type="alc"></div>
  <div id="v" data-ham="meter" data-type="custom" data-label="VDD"
       data-min="10" data-max="16" data-unit="V" data-segments="0"></div>
</div>`,js:`HamUI.init(root);
const [s, p, swr, alc, v] = ['#s', '#p', '#swr', '#alc', '#v'].map(HamUI.getInstance);
let dbm = -90;

every(120, () => {
  dbm = Math.max(-120, Math.min(-40, dbm + (Math.random() - 0.5) * 10));
  s.set(dbm);
  p.set(45 + Math.random() * 8);
  swr.set(1.2 + Math.random() * 0.2);
  alc.set(20 + Math.random() * 20);
  v.set(13.6 + Math.random() * 0.3);
});`},vfo:{label:"VFO + band / mode",html:`<div class="ham-panel ham-panel-body ham-stack" style="--ham-gap: 16px">
  <div class="ham-vfo">
    <span class="ham-vfo-tag is-active">A</span>
    <div id="vfo" data-ham="frequency" data-value="14074000" data-size="xl" data-unit="MHz"></div>
  </div>
  <div id="band" data-ham="band-selector" data-value="20m"></div>
  <div id="mode" data-ham="mode-selector" data-value="USB"></div>
  <div class="ham-mono ham-muted ham-text-sm" id="log">Scroll or drag a digit to tune</div>
</div>`,js:`HamUI.init(root);
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
mode.on('change', (e) => log('mode ' + e.detail.value + ' · passband ' + HamUI.passbandFor(e.detail.value)));`},station:{label:"Knobs + PTT + status bar",html:`<div class="ham-panel ham-panel-clip">
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
</div>`,js:`HamUI.init(root);
const trx = HamUI.getInstance('#trx');
const pwr = HamUI.getInstance('#pwr');
const meter = HamUI.getInstance('#m');
let tx = false;

HamUI.getInstance('#ptt').on('ptt', (e) => {
  tx = e.detail.on;
  trx.set(tx ? 'tx' : 'rx');
  meter.setOff(!tx);
});
every(80, () => { if (tx) meter.set(pwr.get() * (0.9 + Math.random() * 0.1)); });`},datv:{label:"DVB-S2 constellation",html:`<div class="ham-panel ham-panel-body ham-stack" style="max-width: 520px">
  <div id="lock" data-ham="lock-status"></div>
  <div id="iq" data-ham="constellation" data-show-mer="false"></div>
  <div class="ham-meters"><div id="mer" data-ham="mer-meter" data-modcod="16APSK 3/4"></div></div>
</div>`,js:`HamUI.init(root);
const iq = HamUI.getInstance('#iq');
const mer = HamUI.getInstance('#mer');
const lock = HamUI.getInstance('#lock');

// Simulated demodulator: 16APSK 3/4 at 12.5 dB MER, slowly fading
const demod = new HamUI.DvbS2Simulator({ modcod: '16APSK 3/4', merDb: 12.5 });
iq.setModulation('16APSK', '3/4');

every(50, () => {
  const stage = demod.stage();
  lock.set(stage);
  iq.push(demod.next());
  if (stage >= 2) { mer.setOff(false); mer.set(demod.currentMer()); }
  else mer.setOff(true);
});`},scratch:{label:"From scratch (plain JS)",html:'<div id="spec" style="height: 220px"></div>',js:`// No data attributes: construct the component directly
const spec = new HamUI.Spectrum(root.querySelector('#spec'), {
  startHz: sim.startHz, spanHz: sim.spanHz,
  minDb: -130, maxDb: -60, averaging: 0.2,
});
spec.setDial(14074000);
spec.setMarkers([{ hz: 14078000, color: 'warn', dashed: true, label: 'JS8' }]);
every(50, () => spec.update(sim.next()));`}},o=a=>document.querySelector(a),s=o("#html"),n=o("#js"),m=o("#preview"),h=o("#error"),b=o("#status");d.init();for(const a of[s,n])a.addEventListener("keydown",t=>{if(t.key==="Tab"&&!t.shiftKey){t.preventDefault();const{selectionStart:e,selectionEnd:l,value:c}=a;a.value=c.slice(0,e)+"  "+c.slice(l),a.selectionStart=a.selectionEnd=e+2}else t.key==="Enter"&&(t.ctrlKey||t.metaKey)&&(t.preventDefault(),i())}),a.addEventListener("input",()=>{clearTimeout(a._t),a._t=setTimeout(i,700)});let v=[];const y=new d.SignalSimulator({startHz:14069500,spanHz:12e3,bins:2048});function I(){var a;for(const t of v)clearInterval(t);v=[];for(const t of m.querySelectorAll("*"))(a=d.getInstance(t))==null||a.destroy();m.replaceChildren()}function i(){clearTimeout(s._t),clearTimeout(n._t),I(),h.hidden=!0,m.innerHTML=s.value;const a=(t,e)=>{const l=setInterval(()=>{try{e()}catch(c){f(c),clearInterval(l)}},t);return v.push(l),l};try{new Function("HamUI","root","sim","every",`"use strict";
${n.value}`)(d,m,y,a),b.textContent="Ran"}catch(t){f(t)}x()}function f(a){h.hidden=!1,h.textContent=String(a&&a.stack?a.message:a),b.textContent="Error"}const r=o("#preset");r.innerHTML=Object.entries(p).map(([a,t])=>`<option value="${a}">${t.label}</option>`).join("");function u(a){clearTimeout(s._t),clearTimeout(n._t);const t=p[a]||p.panadapter;s.value=t.html,n.value=t.js,i()}const g={enc:a=>btoa(String.fromCharCode(...new TextEncoder().encode(a))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),dec:a=>new TextDecoder().decode(Uint8Array.from(atob(a.replace(/-/g,"+").replace(/_/g,"/")),t=>t.charCodeAt(0)))};function x(){try{localStorage.setItem("hamui-playground-v2",JSON.stringify({preset:r.value,html:s.value,js:n.value}))}catch{}}r.onchange=()=>u(r.value);o("#resetBtn").onclick=()=>u(r.value);o("#runBtn").onclick=i;o("#shareBtn").onclick=async()=>{const a=`${location.href.split("#")[0]}#code=${g.enc(JSON.stringify({html:s.value,js:n.value}))}`;history.replaceState(null,"",a);try{await navigator.clipboard.writeText(a),d.toast({title:"Link copied",tone:"success",timeout:2e3})}catch{d.toast({title:"Link is in the address bar",body:"The browser blocked clipboard access; copy it from the address bar",tone:"info"})}};d.getInstance("#previewTheme").on("change",a=>{m.dataset.theme=a.detail.value});(function(){const t=location.hash.match(/^#code=(.+)$/);if(t)try{const{html:e,js:l}=JSON.parse(g.dec(t[1]));s.value=e,n.value=l,i();return}catch{}try{const e=JSON.parse(localStorage.getItem("hamui-playground-v2")||"null");if(e&&e.html!=null){p[e.preset]&&(r.value=e.preset),s.value=e.html,n.value=e.js,i();return}}catch{}u("panadapter")})();
