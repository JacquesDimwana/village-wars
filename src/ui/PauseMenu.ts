export interface PauseControls {
  setPaused(paused: boolean): void;
  getSpeed(): number;
  setSpeed(speed: number): void;
  restart(): void;
  mainMenu(): void;
}

const SPEEDS = [1, 2];

/** Discreet ⏸ button (top left) opening the pause menu: resume, speed, restart, main menu. */
export class PauseMenu {
  private root: HTMLElement;
  private modal: HTMLElement;
  private badge: HTMLElement;
  private confirmTimer = 0;

  constructor(parent: HTMLElement, private controls: PauseControls) {
    this.root = document.createElement('div');
    this.root.className = 'hud pause-layer';
    this.root.innerHTML = `
      <button class="round small pause-btn" aria-label="Pause"><span class="glyph">⏸</span><span class="badge speed-badge" hidden>×2</span></button>
      <div class="screen pause-modal" hidden>
        <div class="pause-panel">
          <header class="sheet-head"><span class="sheet-icon">⏸</span><h2>Pause</h2><button class="close" data-act="resume" aria-label="Reprendre">✕</button></header>
          <div class="pause-body">
            <button class="btn green big-btn" data-act="resume">▶ Reprendre</button>
            <div class="speed-row"><span>Vitesse</span>
              <div class="seg">${SPEEDS.map((s) => `<button class="btn" data-speed="${s}">×${s}</button>`).join('')}</div>
            </div>
            <div class="pause-row">
              <button class="btn" data-act="restart">↻ Recommencer</button>
              <button class="btn" data-act="menu">🏠 Menu</button>
            </div>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.modal = this.root.querySelector('.pause-modal')!;
    this.badge = this.root.querySelector('.speed-badge')!;

    this.root.querySelector('.pause-btn')!.addEventListener('click', () => this.open(true));
    this.modal.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.modal) return this.open(false); // tap outside the panel
      const btn = target.closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.dataset.speed) {
        controls.setSpeed(Number(btn.dataset.speed));
        this.refresh();
      } else if (btn.dataset.act === 'resume') this.open(false);
      else if (btn.dataset.act === 'menu') controls.mainMenu();
      else if (btn.dataset.act === 'restart') this.confirmRestart(btn);
    });
    this.refresh();
  }

  /** Hides the ⏸ button (end screen). */
  hide(): void {
    this.root.hidden = true;
  }

  private open(open: boolean): void {
    this.modal.hidden = !open;
    this.controls.setPaused(open);
    this.refresh();
  }

  /** Restart loses the current game: needs a second tap. */
  private confirmRestart(btn: HTMLButtonElement): void {
    if (btn.classList.contains('danger')) return this.controls.restart();
    btn.classList.add('danger');
    btn.textContent = 'Sûr ? Touche encore';
    window.clearTimeout(this.confirmTimer);
    this.confirmTimer = window.setTimeout(() => {
      btn.classList.remove('danger');
      btn.textContent = '↻ Recommencer';
    }, 2500);
  }

  private refresh(): void {
    const speed = this.controls.getSpeed();
    this.badge.hidden = speed === 1;
    this.badge.textContent = `×${speed}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.classList.toggle('blue', Number(b.dataset.speed) === speed);
    });
  }
}
