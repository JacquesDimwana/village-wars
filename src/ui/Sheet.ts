import type { GameState } from '../core/types';

/** Bottom sheet that slides up over the game (the map stays usable above it). */
export abstract class Sheet {
  readonly el: HTMLElement;
  protected body: HTMLElement;
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, icon: string, title: string) {
    this.el = document.createElement('section');
    this.el.className = 'sheet';
    this.el.innerHTML = `
      <header class="sheet-head"><span class="sheet-icon">${icon}</span><h2>${title}</h2><button class="close" aria-label="Fermer">✕</button></header>
      <div class="sheet-body"></div>`;
    this.body = this.el.querySelector('.sheet-body')!;
    this.el.querySelector('.close')!.addEventListener('click', () => this.onClose());
    parent.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  setOpen(open: boolean, state: GameState): void {
    this.el.classList.toggle('open', open);
    if (open) this.refresh(state);
  }

  /** Updates the dynamic parts (called a few times per second while open). */
  abstract refresh(state: GameState): void;
}

/** Helper: sets text only when it changed (avoids layout work every refresh). */
export function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Last HTML we wrote per element (the browser re-serializes innerHTML, so we can't compare to it). */
const lastHtml = new WeakMap<Element, string>();

export function setHtml(el: Element | null, html: string): void {
  if (!el || lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}
