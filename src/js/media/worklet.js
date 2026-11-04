// The AudioWorklet processor for AudioStreamPlayer, built at run time from
// the source text of FillController and AudioRing, so it needs no separate
// file or bundler plugin. `${C.name} = ${C}` keeps working when a minifier
// renames the classes (the references inside rename with them).
//
// Messages in:  {type:'pcm', planes: Float32Array[], ticks, rate, gen}
//               {type:'flush', gen}   {type:'target', value}
// Messages out: the ring report plus ctxTime (the AudioContext time the
//               reported position refers to: the end of the rendered quantum)
//               and gen, every 8 render quanta (~21 ms at 48 kHz).
import { FillController, AudioRing } from './audio-core.js';

export const PROCESSOR_NAME = 'hamui-audio-stream';

export function workletSource() {
  const R = AudioRing.name;
  return `const ${FillController.name} = ${FillController};
const ${R} = ${AudioRing};
class HamUIAudioStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.ring = new ${R}({ inRate: o.inRate || sampleRate, outRate: sampleRate, target: o.target || 0.12 });
    this.gen = o.gen || 0;
    this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pcm') {
        if (m.gen !== this.gen) return;
        if (m.rate && m.rate !== this.ring.inRate) this.ring.setRates(m.rate, sampleRate);
        this.ring.push(m.planes, m.ticks);
      } else if (m.type === 'flush') {
        this.gen = m.gen;
        this.ring.flush();
      } else if (m.type === 'target') {
        this.ring.setTarget(m.value);
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    this.ring.read(out, n);
    if ((++this.n & 7) === 0) {
      const r = this.ring.report();
      r.ctxTime = currentTime + n / sampleRate;
      r.gen = this.gen;
      this.port.postMessage(r);
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', HamUIAudioStreamProcessor);
`;
}

const loaded = new WeakMap(); // AudioContext -> Promise

/** Load the processor into a context once. */
export function loadWorklet(ctx) {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}
