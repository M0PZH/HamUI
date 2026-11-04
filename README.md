# HamUI

A quiet, modern UI framework for ham radio software. One stylesheet covers layout and the everyday components (buttons, forms, panels, tabs, tables, toasts, dialogs); one dependency-free script adds the radio instruments: **spectrum, waterfall, panadapter, S/PWR/SWR/ALC meters, VFO frequency display, knobs, band/mode selectors, PTT and station status**.

- Dark by default, light and "follow system" themes via `data-theme`
- Everything themed through `--ham-*` CSS custom properties; canvases repaint on theme change
- Trackpad and touch friendly: pinch to zoom the spectrum/waterfall, two-finger swipe or drag the frequency scale to pan, click or drag to tune; hit targets grow to 44 px on touch screens
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
| Spectrum | `spectrum` | `update(bins, range?)`, averaging, peak hold, dial, passband, markers (`passband`, `own`, `dim`; stacked labels), `dragTune`, `wheelTune`, `channels` (channel strip; `HamUI.bandplans.qo100Wideband`, `qo100Narrowband`) |
| Waterfall | `waterfall` | `push(bins, range?)`, colormaps (`theme`, `viridis`, `inferno`, `plasma`, `turbo`, `gray`), `autoLevel()` |
| Panadapter | `panadapter` | spectrum + waterfall sharing one `FrequencyView` |
| Meter | `meter` | `type`: `s`, `power`, `swr`, `alc`, `custom` |
| FrequencyDisplay | `frequency` | per-digit wheel/drag/keyboard tuning |
| Knob | `knob` | drag, wheel, arrow keys; `endless: true` for relative VFO tuning (`ham:change` {delta, steps, value}) |
| BandSelector / ModeSelector | `band-selector` / `mode-selector` | built on `Segmented` |
| Segmented | `segmented` | one-of-few control |
| Clock, TxIndicator, Ptt | `clock`, `trx`, `ptt` | station status |
| Constellation | `constellation` | DVB-S2 I/Q density plot with QPSK/8PSK/16APSK/32APSK overlay |
| MerMeter | `mer-meter` | MER against the MODCOD's Es/N0 threshold, with decoding margin |
| LockStatus | `lock-status` | demodulator lock steps (Search → Header → Demod → FEC → TS) |
| TrendChart | `trend` | rolling history of a reading with threshold lines |
| VideoPanel | `video` | canvas for decoded video: title, message and stats overlays, mute/volume/level, full screen |
| DecodeList | `decodes` | FT8/FT4 receive log: cycles, CQ / to-me / TX highlighting, filters, `HamUI.parseFt8()` |
| Tabs, Modal, toast() | `tabs`, `modal` | general UI |

`HamUI.haptics` gives haptic feedback at detents (frequency steps, knob steps, segment changes, PTT). The default backend is
`navigator.vibrate` (Android); `HamUI.haptics.use(fn)` routes it elsewhere, e.g. to a Tauri command that calls the macOS trackpad.

Knobs and frequency digits follow the fingers on a trackpad (push up to increase), correcting for macOS natural scrolling;
`HamUI.setScrollDirection('natural' | 'traditional')` overrides the detection.

All events are bubbling `ham:*` CustomEvents: `ham:tune`, `ham:channel`, `ham:viewchange`, `ham:hover`, `ham:change`, `ham:ptt`, `ham:select`, `ham:volume`, `ham:themechange`.

Channel plans are versioned: `HamUI.bandplans.qo100Wideband2021v3` is frozen and never changes (pin it when a layout must stay put);
`HamUI.bandplans.qo100Wideband` always points to the newest version. Each plan has `meta` (version, date, source).
`HamUI.bandplans.qo100Narrowband2020` (alias `qo100Narrowband`) is the AMSAT-DL narrowband plan of 2020-02-14, receive only;
it has no version number, so the key is its year. `HamUI.regionAt(plan, hz)` returns the segment at a frequency.

### hamui/media

A separate entry (`import { AudioStreamPlayer } from 'hamui/media'`, UMD global `HamUIMedia`) with no DOM components:
`AudioStreamPlayer` plays streamed PCM through an AudioWorklet ring buffer whose PI-controlled resampler absorbs sender/sound-card
clock drift, with a jitter-adaptive target, and plays gaps in the stream time as silence; `SyncCore` (with optional timeline epochs), `AudioClock`, `ArrivalClock`, `JitterEstimator` and `VideoQueue` do A/V sync
on an audio master clock; `PtsUnwrapper` and friends handle 90 kHz MPEG PTS. From the PlutoSAT station front end.

`hamui/css` is the whole stylesheet; `hamui/css/core` leaves out the VideoPanel and DecodeList styles
(`src/css/ham/video.css`, `src/css/ham/decodes.css`) so apps can add only what they use.

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
npm run build   # dist/hamui.css, dist/hamui.js (ESM), dist/hamui.umd.cjs, dist/hamui-media.*
npm test        # unit tests (node --test)
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
