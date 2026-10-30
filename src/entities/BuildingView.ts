import Phaser from 'phaser';
import { BUILDINGS } from '../core/config';
import { TILE_SIZE } from '../core/constants';
import type { Building, Village } from '../core/types';

/** Visual for one building. Reads state in sync(); holds no game rules. */
export class BuildingView extends Phaser.GameObjects.Container {
  private base: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private readonly widthPx: number;

  constructor(scene: Phaser.Scene, building: Building, village: Village) {
    const size = BUILDINGS[building.type].size * TILE_SIZE;
    super(scene, building.tx * TILE_SIZE, building.ty * TILE_SIZE);
    this.widthPx = size;

    this.base = scene.add.rectangle(0, 0, size, size, village.color).setOrigin(0).setStrokeStyle(3, 0x1a1a1a);
    const roof = scene.add.triangle(size / 2, size * 0.45, 0, size * 0.35, size / 2, 0, size, size * 0.35, 0x5a3a22);
    const label = scene.add
      .text(size / 2, size + 4, building.type === 'townHall' ? village.name : BUILDINGS[building.type].name, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0);
    const hpBg = scene.add.rectangle(0, -8, size, 5, 0x000000).setOrigin(0);
    this.hpBar = scene.add.rectangle(0, -8, size, 5, 0x2ecc71).setOrigin(0);

    this.add([this.base, roof, hpBg, this.hpBar, label]);
    this.setDepth(10 + building.ty);
    scene.add.existing(this as unknown as Phaser.GameObjects.GameObject);
    this.sync(building);
  }

  sync(b: Building): void {
    this.hpBar.width = this.widthPx * Math.max(0, b.hp / b.maxHp);
    this.base.setAlpha(b.buildProgress < 1 ? 0.4 + 0.6 * b.buildProgress : 1);
  }
}
