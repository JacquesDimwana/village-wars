import { getFlag, setFlag } from '../core/SaveGame';

interface Step {
  /** CSS selector of the HUD element the bubble points at. */
  target: string;
  icon: string;
  title: string;
  text: string;
}

const SEEN_FLAG = 'tutorial-seen';
const REPOSITION_MS = 200;
const MARGIN = 10;

const STEPS: Step[] = [
  {
    target: '.actions-right [data-sheet="build"]',
    icon: '🔨',
    title: 'Construire',
    text: 'Commence par un <b>camp de bûcherons</b> près de la forêt : tes habitants y récolteront du bois.',
  },
  {
    target: '.actions-left [data-sheet="army"]',
    icon: '⚔️',
    title: 'Armée',
    text: 'Forge des armes, puis arme tes habitants. Attention : un guerrier <b>ne travaille plus</b> !',
  },
  {
    target: '.minimap',
    icon: '🗺️',
    title: 'La carte',
    text: 'Elle se dévoile à mesure que tu explores. Touche-la pour y déplacer la vue.',
  },
  {
    target: '.actions-left [data-sheet="diplomacy"]',
    icon: '🤝',
    title: 'Diplomatie',
    text: 'Trouve les 5 villages voisins. Allie-toi… ou détruis leur hôtel de ville pour gagner !',
  },
];

/** 4 bubbles pointing at the HUD buttons, skippable, shown once (flag in localStorage). */
export class Tutorial {
  private el: HTMLElement;
  private ring: HTMLElement;
  private bubble: HTMLElement;
  private index = 0;
  private timer = 0;

  static shouldShow(): boolean {
    return !getFlag(SEEN_FLAG);
  }

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud tutorial';
    this.el.innerHTML = '<div class="tuto-ring"></div><div class="tuto-bubble"></div>';
    this.ring = this.el.querySelector('.tuto-ring')!;
    this.bubble = this.el.querySelector('.tuto-bubble')!;
    this.bubble.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
      if (act === 'skip') this.finish();
      else if (act === 'next') this.go(this.index + 1);
    });
    parent.appendChild(this.el);
    this.go(0);
    this.timer = window.setInterval(() => this.place(), REPOSITION_MS);
    window.addEventListener('resize', this.place);
  }

  private go(index: number): void {
    if (index >= STEPS.length) return this.finish();
    this.index = index;
    const step = STEPS[index];
    const last = index === STEPS.length - 1;
    this.bubble.innerHTML = `
      <div class="tuto-head"><span class="tuto-icon">${step.icon}</span><b>${step.title}</b><small>${index + 1}/${STEPS.length}</small></div>
      <p>${step.text}</p>
      <div class="tuto-actions">
        ${last ? '' : '<button class="btn small" data-act="skip">Passer</button>'}
        <button class="btn small green" data-act="next">${last ? 'C’est parti !' : 'Suivant ▸'}</button>
      </div>
      <i class="tuto-arrow"></i>`;
    this.bubble.classList.remove('pop');
    void this.bubble.offsetWidth; // restart the pop animation
    this.bubble.classList.add('pop');
    this.place();
  }

  /** Puts the bubble above (bottom buttons) or below (minimap) its target, arrow on the target. */
  private place = (): void => {
    const target = document.querySelector<HTMLElement>(STEPS[this.index].target);
    const r = target?.getBoundingClientRect();
    const visible = !!r && r.width > 0 && getComputedStyle(target!).opacity !== '0';
    this.ring.hidden = !visible;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    if (!r || !visible) {
      this.bubble.style.left = `${(vw - bw) / 2}px`;
      this.bubble.style.top = `${(vh - bh) / 2}px`;
      this.bubble.dataset.side = 'none';
      return;
    }
    const pad = 6;
    Object.assign(this.ring.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const cx = r.left + r.width / 2;
    const below = r.top + r.height / 2 < vh / 2;
    const left = Math.min(Math.max(MARGIN, cx - bw / 2), vw - bw - MARGIN);
    const top = below ? r.bottom + 16 : r.top - bh - 16;
    this.bubble.style.left = `${left}px`;
    this.bubble.style.top = `${Math.min(Math.max(MARGIN, top), vh - bh - MARGIN)}px`;
    this.bubble.dataset.side = below ? 'below' : 'above';
    this.bubble.style.setProperty('--arrow-x', `${Math.min(Math.max(18, cx - left), bw - 18)}px`);
  };

  private finish(): void {
    setFlag(SEEN_FLAG);
    window.clearInterval(this.timer);
    window.removeEventListener('resize', this.place);
    this.el.remove();
  }
}
