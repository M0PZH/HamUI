// Segmented control: one value from a few. Arrow keys move the selection.
import { Component, h } from '../core/dom.js';
import { haptics } from '../core/haptics.js';

const DEFAULTS = {
  items: null,   // ['A','B'] or [{value, label, disabled, title}]; default: existing buttons
  value: null,
  label: null,   // accessible group name
  haptics: true, // haptic 'select' when the user changes the value
};

export class Segmented extends Component {
  constructor(el, options = {}, defaults = {}) {
    super(el, options, { ...DEFAULTS, ...defaults });
    this.el.classList.add('ham-seg');
    this.el.setAttribute('role', 'radiogroup');
    if (this.options.label) this.el.setAttribute('aria-label', this.options.label);
    if (this.options.items) this.setItems(this.options.items, this.options.value);
    else this._adopt();
    this.listen(this.el, 'click', (e) => {
      const b = e.target.closest('button');
      if (b && this.el.contains(b) && !b.disabled) this.select(b.dataset.value, { source: 'user' });
    });
    this.listen(this.el, 'keydown', (e) => this._key(e));
  }

  _adopt() {
    this.buttons = [...this.el.querySelectorAll(':scope > button')];
    this.buttons.forEach((b) => {
      b.type = 'button';
      b.setAttribute('role', 'radio');
      if (b.dataset.value == null) b.dataset.value = b.textContent.trim();
    });
    const pressed = this.buttons.find((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true');
    this._apply(this.options.value ?? pressed?.dataset.value ?? null);
  }

  setItems(items, value = this.value) {
    this.el.replaceChildren(...items.map((it) => {
      const item = typeof it === 'object' ? it : { value: String(it), label: String(it) };
      return h('button', { type: 'button', role: 'radio', 'data-value': item.value, disabled: item.disabled, title: item.title, text: item.label ?? item.value });
    }));
    this.buttons = [...this.el.children];
    this._apply(value);
  }

  _apply(value) {
    this.value = value == null ? null : String(value);
    let any = false;
    for (const b of this.buttons) {
      const on = b.dataset.value === this.value;
      any ||= on;
      b.setAttribute('aria-checked', on);
      b.setAttribute('aria-pressed', on);
      b.tabIndex = on ? 0 : -1;
    }
    if (!any && this.buttons[0]) this.buttons[0].tabIndex = 0;
  }

  /** Select a value. Emits ham:change {value} when it changes. */
  select(value, { silent = false, source = 'api' } = {}) {
    const v = value == null ? null : String(value);
    if (v === this.value) return;
    this._apply(v);
    if (source === 'user' && this.options.haptics) haptics.fire('select', { source: this });
    if (!silent) this.emit('change', { ...this.changeDetail(this.value), source });
  }

  /** Hook: extra fields for the ham:change detail. */
  changeDetail(value) { return { value }; }

  get() { return this.value; }

  _key(e) {
    const enabled = this.buttons.filter((b) => !b.disabled);
    const i = enabled.findIndex((b) => b.dataset.value === this.value);
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = enabled.length - 1;
    if (j == null) return;
    e.preventDefault();
    this.select(enabled[j].dataset.value, { source: 'user' });
    enabled[j].focus();
  }
}
