// A canvas that tracks its container's size and device pixel ratio.

export class Surface {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {(s: Surface) => void} [opts.onResize]
   * @param {'device'|'css'} [opts.resolution] backing store in device or CSS pixels
   * @param {number} [opts.maxDpr] cap for very dense screens (default 2)
   * @param {string} [opts.className]
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = { resolution: 'device', maxDpr: 2, ...opts };
    this.canvas = document.createElement('canvas');
    if (opts.className) this.canvas.className = opts.className;
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = 0;   // backing pixels
    this.height = 0;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
    this._ro = new ResizeObserver(() => this.measure());
    this._ro.observe(container);
    this._onDpr = () => this.measure();
    this._watchDpr();
    this.measure();
  }

  _watchDpr() {
    if (typeof matchMedia !== 'function') return;
    this._mq?.removeEventListener('change', this._onDpr);
    this._mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this._mq.addEventListener('change', this._onDpr, { once: true });
  }

  measure() {
    const r = this.container.getBoundingClientRect();
    const dpr = this.opts.resolution === 'css' ? 1 : Math.min(this.opts.maxDpr, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const hgt = Math.max(1, Math.round(r.height * dpr));
    this.cssWidth = r.width;
    this.cssHeight = r.height;
    if (w === this.width && hgt === this.height && dpr === this.dpr) return;
    this.dpr = dpr;
    this.width = this.canvas.width = w;
    this.height = this.canvas.height = hgt;
    this._watchDpr();
    this.opts.onResize?.(this);
  }

  destroy() {
    this._ro.disconnect();
    this._mq?.removeEventListener('change', this._onDpr);
    this.canvas.remove();
  }
}

/** Coalesce many draw requests into one per animation frame. */
export function frameScheduler(draw) {
  let id = 0;
  const run = () => { id = 0; draw(); };
  return {
    request() { if (!id) id = requestAnimationFrame(run); },
    cancel() { if (id) cancelAnimationFrame(id); id = 0; },
  };
}
