import Phaser from 'phaser';
import { PLAYER_ID } from '../core/constants';
import { bus } from '../core/EventBus';
import type { ResourceType } from '../core/types';
import { civilians, housingCap, warriors } from '../systems/PopulationSystem';
import type { GameScene } from './GameScene';

const ICONS: Record<ResourceType, string> = { wood: '🪵', stone: '🪨', ore: '⛏️', iron: '⚙️' };
const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: '17px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 4,
};

/** HUD drawn on top of the world, not affected by camera zoom/scroll. */
export class UIScene extends Phaser.Scene {
  private resourceText!: Phaser.GameObjects.Text;
  private popText!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    const bar = this.add.rectangle(0, 0, this.scale.width, 66, 0x000000, 0.55).setOrigin(0);
    this.resourceText = this.add.text(12, 8, '', TEXT_STYLE);
    this.popText = this.add.text(12, 36, '', TEXT_STYLE);

    const buildBtn = this.makeButton('🏗️ Construire', 12, this.scale.height - 60);
    const armyBtn = this.makeButton('⚔️ Armée', 190, this.scale.height - 60);
    const diploBtn = this.makeButton('🤝 Diplomatie', 330, this.scale.height - 60);
    // Placeholders until the agents plug in their menus.
    buildBtn.on('pointerup', () => bus.emit('notify', { message: 'Construction : à implémenter (agent A)' }));
    armyBtn.on('pointerup', () => bus.emit('notify', { message: 'Armurerie / caserne : à implémenter (agent B)' }));
    diploBtn.on('pointerup', () => bus.emit('notify', { message: 'Diplomatie : à implémenter (agent E)' }));

    this.toast = this.add.text(this.scale.width / 2, 80, '', TEXT_STYLE).setOrigin(0.5, 0).setAlpha(0);

    const refreshIfPlayer = ({ villageId }: { villageId: string }) => {
      if (villageId === PLAYER_ID) this.refresh();
    };
    this.unsubscribers.push(
      bus.on('resources:changed', refreshIfPlayer),
      bus.on('population:changed', refreshIfPlayer),
      bus.on('weapons:changed', refreshIfPlayer),
      bus.on('notify', ({ message }) => this.showToast(message)),
    );

    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      bar.width = size.width;
      this.toast.x = size.width / 2;
      for (const b of [buildBtn, armyBtn, diploBtn]) b.y = size.height - 60;
    });
    this.events.once('shutdown', () => this.unsubscribers.forEach((u) => u()));
    this.refresh();
  }

  private refresh(): void {
    const state = (this.scene.get('Game') as GameScene).state;
    if (!state) return;
    const v = state.villages[PLAYER_ID];
    const res = (Object.keys(ICONS) as ResourceType[]).map((k) => `${ICONS[k]} ${v.resources[k]}`);
    this.resourceText.setText(res.join('   '));
    const pop = [
      `👷 ${civilians(state, PLAYER_ID)} au travail`,
      `🛡️ ${warriors(state, PLAYER_ID).length} guerriers`,
      `🏠 ${housingCap(state, PLAYER_ID)} places`,
      `🗡️ ${v.weapons.sword}  🏹 ${v.weapons.bow}`,
    ];
    this.popText.setText(pop.join('   '));
  }

  private showToast(message: string): void {
    this.toast.setText(message).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 2000, duration: 500 });
  }

  private makeButton(label: string, x: number, y: number): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, label, { ...TEXT_STYLE, backgroundColor: '#2c3e50', padding: { x: 14, y: 10 } })
      .setInteractive({ useHandCursor: true });
  }
}
