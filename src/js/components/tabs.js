// Tabs: <div class="ham-tabs" role="tablist"><button role="tab" aria-controls="p1">…</button></div>
import { Component } from '../core/dom.js';

export class Tabs extends Component {
  constructor(el, options = {}) {
    super(el, options, { index: null });
    this.el.classList.add('ham-tabs');
    this.el.setAttribute('role', 'tablist');
    this.tabs = [...this.el.querySelectorAll('[role="tab"]')];
    this.tabs.forEach((t) => { if (t.tagName === 'BUTTON') t.type = 'button'; });
    const initial = this.options.index ?? Math.max(0, this.tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    this.select(initial, { silent: true });
    this.listen(this.el, 'click', (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) this.select(this.tabs.indexOf(t));
    });
    this.listen(this.el, 'keydown', (e) => {
      const i = this.index;
      const n = this.tabs.length;
      const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      this.select(j);
      this.tabs[j].focus();
    });
  }

  select(index, { silent = false } = {}) {
    if (index < 0 || index >= this.tabs.length) return;
    const changed = index !== this.index;
    this.index = index;
    this.tabs.forEach((t, i) => {
      const on = i === index;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      const id = t.getAttribute('aria-controls');
      const panel = id && document.getElementById(id);
      if (panel) { panel.hidden = !on; panel.setAttribute('role', 'tabpanel'); }
    });
    if (changed && !silent) this.emit('change', { index, tab: this.tabs[index] });
  }
}
