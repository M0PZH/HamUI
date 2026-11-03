# HamUI

A quiet, modern UI framework for ham radio software. One stylesheet covers layout and the everyday components (buttons, forms, panels, tabs, tables, toasts, dialogs); one dependency-free script adds the radio instruments: **spectrum, waterfall, panadapter, S/PWR/SWR/ALC meters, VFO frequency display, knobs, band/mode selectors, PTT and station status**.

- Dark by default, light and "follow system" themes via `data-theme`
- Everything themed through `--ham-*` CSS custom properties; canvases repaint on theme change
- Trackpad and touch friendly: pinch to zoom the spectrum/waterfall, two-finger swipe to pan, tap to tune; hit targets grow to 44 px on touch screens
- Bootstrap-style data API (`data-ham="spectrum"` + `HamUI.init()`) or plain classes (`new HamUI.Spectrum(el, opts)`)

## Use

```html
<link rel="stylesheet" href="dist/hamui.css">
<script src="dist/hamui.umd.cjs"></script>
<script>HamUI.init();</script>
```

As an ES module:

```js
import 'hamui/css';
import HamUI, { Panadapter, Meter } from 'hamui';

const pan = new Panadapter('#pan', { startHz: 14069500, spanHz: 12000 });
pan.setDial(14074000);
pan.setPassband(HamUI.passbandFor('USB', 2900));
pan.on('tune', (e) => rig.setFrequency(e.detail.hz));
setInterval(() => pan.push(fftFrameInDbm()), 50);
```

Without a bundler the source works natively: link `src/css/hamui.css` and `import HamUI from './src/js/index.js'`.

## Components

| Name | `data-ham` | Notes |
| --- | --- | --- |
| Spectrum | `spectrum` | `update(bins, range?)`, averaging, peak hold, dial, passband, markers |
| Waterfall | `waterfall` | `push(bins, range?)`, colormaps (`theme`, `viridis`, `inferno`, `plasma`, `turbo`, `gray`), `autoLevel()` |
| Panadapter | `panadapter` | spectrum + waterfall sharing one `FrequencyView` |
| Meter | `meter` | `type`: `s`, `power`, `swr`, `alc`, `custom` |
| FrequencyDisplay | `frequency` | per-digit wheel/drag/keyboard tuning |
| Knob | `knob` | drag, wheel, arrow keys |
| BandSelector / ModeSelector | `band-selector` / `mode-selector` | built on `Segmented` |
| Segmented | `segmented` | one-of-few control |
| Clock, TxIndicator, Ptt | `clock`, `trx`, `ptt` | station status |
| Constellation | `constellation` | DVB-S2 I/Q density plot with QPSK/8PSK/16APSK/32APSK overlay |
| MerMeter | `mer-meter` | MER against the MODCOD's Es/N0 threshold, with decoding margin |
| LockStatus | `lock-status` | demodulator lock steps (Search → Header → Demod → FEC → TS) |
| TrendChart | `trend` | rolling history of a reading with threshold lines |
| Tabs, Modal, toast() | `tabs`, `modal` | general UI |

All events are bubbling `ham:*` CustomEvents: `ham:tune`, `ham:viewchange`, `ham:hover`, `ham:change`, `ham:ptt`, `ham:themechange`.

`HamUI.SignalSimulator` produces plausible band activity (FT8, JS8, CW, carriers) and
`HamUI.DvbS2Simulator` DVB-S2 symbols and lock sequences, for demos and tests.
`HamUI.dvbs2` has the MODCOD table (EN 302 307 Es/N0 thresholds), constellation geometry, MER and bitrate helpers.

## Docs, demo and playground

Live at **https://m0pzh.github.io/HamUI/** (built from `main` by `.github/workflows/pages.yml`):
the documentation (`index.html`), a full radio panel (`demo/radio.html`), a DATV receiver (`demo/datv.html`) and a
playground (`playground.html`) where you can edit HTML/JS against HamUI and share the result as a link.

## Develop

```sh
npm install
npm run dev     # docs at /, full radio demo at /demo/radio.html
npm run build   # dist/hamui.css, dist/hamui.js (ESM), dist/hamui.umd.cjs
npm run build:site  # static docs site in site-dist/
```

## Layout

```
src/css/        tokens, base, layout, utilities, components/, ham/
src/js/core/    dom, theme, canvas, colormap, format, gestures
src/js/components/  segmented, tabs, toast, modal, tooltip, range
src/js/ham/     spectrum, waterfall, panadapter, meter, frequency, knob, selectors, station, view, bands
src/js/sim/     signal simulator
docs/, index.html, demo/   documentation and demo pages
```
