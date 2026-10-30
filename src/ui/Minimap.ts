import { BUILDINGS, GAME } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { GameState, TileType } from '../core/types';
import { TILE_COLOR } from '../render/Terrain';
import { isExplored } from '../systems/FogSystem';

const UNEXPLORED = [74, 79, 82];
const REDRAW_MS = 250;

export interface MinimapView {
  /** Camera target on the ground (tile coordinates). */
  x: number;
  y: number;
  /** Approximate radius of ground seen by the camera, in tiles. */
  radius: number;
}

/**
 * Top-right minimap: 1 pixel per tile over a fixed square around the player's town hall.
 * Unexplored tiles are grey; explored tiles show the terrain. Tap → move the camera there.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Terrain layer, redrawn only when the fog version changes. */
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private image: ImageData;
  /** Terrain color per pixel, computed lazily the first time a tile is explored. */
  private colors: Int32Array;
  private size: number;
  private originX: number;
  private originY: number;
  private fogVersion = -1;
  private lastDraw = 0;

  constructor(
    parent: HTMLElement,
    center: { x: number; y: number },
    private getState: () => GameState,
    private tileAt: (tx: number, ty: number) => TileType,
    private getView: () => MinimapView,
    onJump: (x: number, y: number) => void,
  ) {
    const half = GAME.minimap.halfSize;
    this.size = half * 2;
    this.originX = Math.round(center.x) - half;
    this.originY = Math.round(center.y) - half;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size;
    this.baseCtx = this.base.getContext('2d')!;
    this.image = this.baseCtx.createImageData(this.size, this.size);
    this.colors = new Int32Array(this.size * this.size).fill(-1);
    parent.appendChild(this.canvas);

    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const rect = this.canvas.getBoundingClientRect();
      const x = this.originX + ((e.clientX - rect.left) / rect.width) * this.size;
      const y = this.originY + ((e.clientY - rect.top) / rect.height) * this.size;
      onJump(x, y);
      this.lastDraw = 0;
    });
  }

  /** Called every frame; redraws at most every REDRAW_MS. */
  update(now: number): void {
    if (now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    const state = this.getState();
    if (state.fog.version !== this.fogVersion) {
      this.fogVersion = state.fog.version;
      this.drawTerrain(state);
    }
    this.ctx.drawImage(this.base, 0, 0);
    this.drawEntities(state);
  }

  private drawTerrain(state: GameState): void {
    const data = this.image.data;
    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const i = py * this.size + px;
        let rgb = UNEXPLORED;
        if (isExplored(state.fog, this.originX + px, this.originY + py)) {
          if (this.colors[i] < 0) this.colors[i] = TILE_COLOR[this.tileAt(this.originX + px, this.originY + py)];
          const c = this.colors[i];
          rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
        }
        data[i * 4] = rgb[0];
        data[i * 4 + 1] = rgb[1];
        data[i * 4 + 2] = rgb[2];
        data[i * 4 + 3] = 255;
      }
    }
    this.baseCtx.putImageData(this.image, 0, 0);
  }

  private drawEntities(state: GameState): void {
    const ctx = this.ctx;
    for (const b of Object.values(state.buildings)) {
      const size = BUILDINGS[b.type].size;
      // Enemy buildings only once the player has explored them.
      if (b.ownerId !== PLAYER_ID && !isExplored(state.fog, b.tx, b.ty)) continue;
      const big = b.type === 'townHall' ? 2 : 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(b.tx - this.originX - big, b.ty - this.originY - big, size + big * 2, size + big * 2);
      ctx.fillStyle = hex(state.villages[b.ownerId].color);
      ctx.fillRect(b.tx - this.originX, b.ty - this.originY, size, size);
    }

    ctx.fillStyle = '#fff';
    for (const u of Object.values(state.units)) {
      if (u.ownerId === PLAYER_ID) ctx.fillRect(Math.round(u.x - this.originX) - 1, Math.round(u.y - this.originY) - 1, 2, 2);
    }

    const view = this.getView();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(view.x - this.originX, view.y - this.originY, view.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
