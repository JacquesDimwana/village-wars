import Phaser from 'phaser';
import { TILE_SIZE } from '../core/constants';
import type { Unit, Village } from '../core/types';

const RADIUS: Record<Unit['type'], number> = { archer: 8, knight: 10 };

/** Visual for one unit. Position is interpolated from state in sync(). */
export class UnitView extends Phaser.GameObjects.Arc {
  constructor(scene: Phaser.Scene, unit: Unit, village: Village) {
    super(scene, 0, 0, RADIUS[unit.type], 0, 360, false, village.color);
    this.setStrokeStyle(2, unit.type === 'archer' ? 0xffffff : 0x000000);
    scene.add.existing(this);
    this.sync(unit);
  }

  sync(u: Unit): void {
    this.setPosition(u.x * TILE_SIZE + TILE_SIZE / 2, u.y * TILE_SIZE + TILE_SIZE / 2);
    this.setDepth(20 + u.y);
  }
}
