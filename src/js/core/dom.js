// Small DOM helpers and the Component base class shared by every widget.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Accept an element or a selector. */
export function resolve(target, root = document) {
  if (typeof target === 'string') return root.querySelector(target);
  return target || null;
}

/** Dispatch a bubbling `ham:<name>` CustomEvent. */
export function emit(el, name, detail) {
  return el.dispatchEvent(new CustomEvent(`ham:${name}`, { detail, bubbles: true }));
}

/** Tiny element factory: h('div', {class: 'x', onclick: fn}, [children]) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Turn data-* attributes into an options object (numbers, booleans and JSON are parsed). */
export function datasetOptions(el) {
  const out = {};
  for (const [k, raw] of Object.entries(el.dataset)) {
    if (k === 'ham' || k === 'theme') continue;
    out[k] = parseValue(raw);
  }
  return out;
}

function parseValue(raw) {
  if (raw === '') return true;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw)) return Number(raw);
  if (/^[[{]/.test(raw)) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return raw;
}

const instances = new WeakMap();

/** Return the HamUI instance attached to an element (created by `new` or `HamUI.init`). */
export function getInstance(target) {
  const el = resolve(target);
  return el ? instances.get(el) || null : null;
}

export class Component {
  constructor(target, options = {}, defaults = {}) {
    const el = resolve(target);
    if (!el) throw new Error(`HamUI: element not found (${target})`);
    const prev = instances.get(el);
    if (prev) prev.destroy();
    this.el = el;
    this.options = { ...defaults, ...datasetOptions(el), ...options };
    this._cleanup = [];
    instances.set(el, this);
  }

  /** Listen to `ham:<name>` on this component. Returns an unsubscribe function. */
  on(name, fn) {
    const type = `ham:${name}`;
    this.el.addEventListener(type, fn);
    return () => this.el.removeEventListener(type, fn);
  }

  emit(name, detail) {
    return emit(this.el, name, detail);
  }

  /** addEventListener that is undone by destroy(). */
  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  /** Register any teardown function. */
  onDestroy(fn) {
    this._cleanup.push(fn);
  }

  destroy() {
    for (const fn of this._cleanup.splice(0)) fn();
    if (instances.get(this.el) === this) instances.delete(this.el);
  }
}
