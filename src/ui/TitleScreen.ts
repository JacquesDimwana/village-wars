import { formatDuration } from './EndScreen';

export type TitleChoice = 'new' | 'continue';

/**
 * Title screen, also used as the loading screen: the progress bar is replaced by the
 * buttons once assets are loaded. « Continuer » only shows when a save exists.
 */
export class TitleScreen {
  private el: HTMLElement;
  private fill: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud screen title-screen';
    this.el.innerHTML = `
      <div class="title-sun"></div>
      <div class="title-hills"><i></i><i></i><i></i></div>
      <div class="title-main">
        <div class="title-crest">⚔️</div>
        <h1 class="title-logo">Village Wars</h1>
        <p class="title-tag outlined">Fais grandir ton village. Récolte, bâtis, forme ton armée. Reste le dernier debout.</p>
        <div class="title-actions">
          <div class="bar title-progress"><div></div></div>
        </div>
      </div>`;
    this.fill = this.el.querySelector('.title-progress div')!;
    parent.appendChild(this.el);
  }

  progress(ratio: number): void {
    this.fill.style.width = `${Math.round(ratio * 100)}%`;
  }

  /** Shows the menu buttons and resolves with the player's choice. */
  choose(saveTimeMs: number | null): Promise<TitleChoice> {
    const actions = this.el.querySelector('.title-actions')!;
    actions.innerHTML = `
      ${saveTimeMs !== null ? `<button class="btn green big-btn" data-c="continue">▶ Continuer<small>Partie en cours · ${formatDuration(saveTimeMs)}</small></button>` : ''}
      <button class="btn ${saveTimeMs !== null ? '' : 'green'} big-btn" data-c="new">⚒️ Nouvelle partie</button>`;
    return new Promise((resolve) => {
      actions.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-c]');
        if (btn) resolve(btn.dataset.c as TitleChoice);
      });
    });
  }

  close(): void {
    this.el.classList.add('leaving');
    window.setTimeout(() => this.el.remove(), 400);
  }
}
