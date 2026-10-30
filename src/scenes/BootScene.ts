import Phaser from 'phaser';

/** Loads assets. Add Kenney sprite sheets / audio here with this.load.*. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // e.g. this.load.spritesheet('tiles', 'assets/tiles.png', { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    this.scene.start('Game');
    this.scene.launch('UI');
  }
}
