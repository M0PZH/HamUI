// Modal on top of <dialog>. Open with new Modal(el).open() or a trigger
// <button data-ham-open="#dialogId">. Elements with data-ham-close close it.
import { Component, resolve, getInstance } from '../core/dom.js';

export class Modal extends Component {
  constructor(el, options = {}) {
    super(el, options, { dismissible: true });
    this.el.classList.add('ham-modal');
    this.listen(this.el, 'click', (e) => {
      if (e.target.closest('[data-ham-close]')) { this.close(); return; }
      // click on the backdrop (outside the dialog box)
      if (this.options.dismissible && e.target === this.el) {
        const r = this.el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close();
      }
    });
    this.listen(this.el, 'cancel', (e) => { if (!this.options.dismissible) e.preventDefault(); });
    this.listen(this.el, 'close', () => this.emit('close', { returnValue: this.el.returnValue }));
  }
  open() { if (!this.el.open) { this.el.showModal(); this.emit('open'); } }
  close(value) { if (this.el.open) this.el.close(value); }
  toggle() { this.el.open ? this.close() : this.open(); }
}

/** Delegated data-ham-open triggers. */
export function bindModalTriggers(root = document) {
  const onClick = (e) => {
    const t = e.target.closest('[data-ham-open]');
    if (!t) return;
    const dlg = resolve(t.dataset.hamOpen);
    if (!dlg) return;
    e.preventDefault();
    (getInstance(dlg) || new Modal(dlg)).open();
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
