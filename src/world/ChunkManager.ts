import Phaser from 'phaser';
import { TILE_SIZE } from '../core/constants';
import type { TileType } from '../core/types';
import { hash2 } from '../core/rng';
import type { WorldGen } from './WorldGen';

// Placeholder colors until Kenney tiles are added (swap for a tileset later).
const TILE_COLORS: Record<TileType, number> = {
  water: 0x2e6fa8,
  sand: 0xd9c38c,
  grass: 0x5b9a44,
  forest: 0x2f6b2a,
  rock: 0x8a8a8a,
  ore: 0x8a5a3c,
};

/**
 * Renders the infinite world as chunks around the camera and unloads distant ones.
 * Each chunk is one Graphics object (cheap to create, one draw call).
 */
export class ChunkManager {
  private chunks = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly chunkPx: number;

  constructor(
    private scene: Phaser.Scene,
    private world: WorldGen,
    private chunkSize: number,
    private margin: number,
  ) {
    this.chunkPx = chunkSize * TILE_SIZE;
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const minCx = Math.floor(view.x / this.chunkPx) - this.margin;
    const maxCx = Math.floor((view.x + view.width) / this.chunkPx) + this.margin;
    const minCy = Math.floor(view.y / this.chunkPx) - this.margin;
    const maxCy = Math.floor((view.y + view.height) / this.chunkPx) + this.margin;

    const wanted = new Set<string>();
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx},${cy}`;
        wanted.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this.buildChunk(cx, cy));
      }
    }
    for (const [key, g] of this.chunks) {
      if (!wanted.has(key)) {
        g.destroy();
        this.chunks.delete(key);
      }
    }
  }

  /** Redraw a single tile's chunk (e.g. after a resource tile is depleted). */
  invalidateTile(tx: number, ty: number): void {
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const key = `${cx},${cy}`;
    const g = this.chunks.get(key);
    if (g) {
      g.destroy();
      this.chunks.set(key, this.buildChunk(cx, cy));
    }
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  private buildChunk(cx: number, cy: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics().setDepth(0);
    const startX = cx * this.chunkSize;
    const startY = cy * this.chunkSize;
    for (let y = 0; y < this.chunkSize; y++) {
      for (let x = 0; x < this.chunkSize; x++) {
        const tx = startX + x;
        const ty = startY + y;
        const type = this.world.getTile(tx, ty);
        // Slight per-tile shade variation so the ground doesn't look flat.
        const shade = 0.9 + hash2(tx, ty, this.world.seed) * 0.2;
        g.fillStyle(shadeColor(TILE_COLORS[type], shade), 1);
        g.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        if (type === 'forest') {
          g.fillStyle(0x1e4d1b, 1);
          g.fillCircle(tx * TILE_SIZE + 16, ty * TILE_SIZE + 14, 9);
        } else if (type === 'ore') {
          g.fillStyle(0xc0c0c0, 1);
          g.fillCircle(tx * TILE_SIZE + 11, ty * TILE_SIZE + 12, 3);
          g.fillCircle(tx * TILE_SIZE + 21, ty * TILE_SIZE + 20, 3);
        }
      }
    }
    return g;
  }
}

function shadeColor(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const gr = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (gr << 8) | b;
}
