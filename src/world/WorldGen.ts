import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { createRng, hash2 } from '../core/rng';
import { BUILDINGS, GAME } from '../core/config';
import type { TilePos, TileType } from '../core/types';

const BUILDABLE: ReadonlySet<TileType> = new Set(['grass', 'sand']);
const WALKABLE: ReadonlySet<TileType> = new Set(['grass', 'sand', 'forest', 'rock', 'iron']);

export const isBuildable = (t: TileType): boolean => BUILDABLE.has(t);
export const isWalkable = (t: TileType): boolean => WALKABLE.has(t);

export interface SpawnPoint extends TilePos {
  villageId: string;
}

/**
 * Deterministic finite terrain. Same seed → same world.
 * Pure TypeScript (no Three.js) so it can be unit-tested.
 */
export class WorldGen {
  readonly seed: number;
  readonly spawns: SpawnPoint[];
  private elevation: NoiseFunction2D;
  private moisture: NoiseFunction2D;
  private rockiness: NoiseFunction2D;
  private clearRadius: number;

  constructor(seed: number, aiCount: number = GAME.aiCount) {
    this.seed = seed;
    const rng = createRng(seed);
    this.elevation = createNoise2D(rng);
    this.moisture = createNoise2D(rng);
    this.rockiness = createNoise2D(rng);
    this.clearRadius = Math.floor(BUILDINGS.townHall.size / 2) + GAME.clearRadiusAroundTownHall;
    this.spawns = this.computeSpawns(aiCount, rng);
  }

  /** Gentle visual relief, shared by the terrain and its occupants. */
  visualHeight(x: number, z: number): number {
    return this.elevation(x * 0.025, z * 0.025) * 0.07
      + this.elevation(x * 0.08, z * 0.08) * 0.025;
  }

  /** Terrain at a tile, including the forced clearings around town halls. */
  getTile(tx: number, ty: number): TileType {
    if (Math.max(Math.abs(tx), Math.abs(ty)) > GAME.map.halfSize) return 'water';
    for (const s of this.spawns) {
      if (Math.abs(tx - s.tx) <= this.clearRadius && Math.abs(ty - s.ty) <= this.clearRadius) {
        return 'grass';
      }
    }
    return this.rawTile(tx, ty);
  }

  /** Terrain from noise only. */
  rawTile(tx: number, ty: number): TileType {
    const edgeDistance = GAME.map.halfSize - Math.max(Math.abs(tx), Math.abs(ty));
    if (edgeDistance < 0) return 'water';
    const coast = Math.max(0, 1 - edgeDistance / GAME.map.borderWidth);
    const e =
      this.elevation(tx * 0.025, ty * 0.025) * 0.7 + this.elevation(tx * 0.08, ty * 0.08) * 0.3;
    const coastalElevation = e - coast * 1.5;
    if (coastalElevation < -0.4) return 'water';
    if (coastalElevation < -0.32) return 'sand';

    const r = this.rockiness(tx * 0.06, ty * 0.06);
    if (r > 0.45) {
      return r > 0.55 && hash2(tx, ty, this.seed) < 0.2 ? 'iron' : 'rock';
    }
    const m = this.moisture(tx * 0.07, ty * 0.07);
    if (m > 0.2) return 'forest';
    return 'grass';
  }

  /** Share of walkable tiles in a square around a point (0..1). */
  landRatio(cx: number, cy: number, radius: number): number {
    let land = 0;
    let total = 0;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        total++;
        if (this.rawTile(x, y) !== 'water') land++;
      }
    }
    return land / total;
  }

  /** Closest point (spiral search) around a target with enough land to build a village. */
  private findGoodSpot(target: TilePos): TilePos {
    const limit = GAME.map.halfSize - GAME.map.borderWidth - 8;
    target = { tx: Math.max(-limit, Math.min(limit, target.tx)), ty: Math.max(-limit, Math.min(limit, target.ty)) };
    const maxRadius = 40;
    for (let r = 0; r <= maxRadius; r += 2) {
      for (let dy = -r; dy <= r; dy += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { tx: target.tx + dx, ty: target.ty + dy };
          if (Math.abs(p.tx) > limit || Math.abs(p.ty) > limit) continue;
          if (this.landRatio(p.tx, p.ty, 7) >= 0.85) return p;
        }
      }
    }
    return target;
  }

  private computeSpawns(aiCount: number, rng: () => number): SpawnPoint[] {
    const spawns: SpawnPoint[] = [{ villageId: 'player', ...this.findGoodSpot({ tx: 0, ty: 0 }) }];
    const offset = rng() * Math.PI * 2;
    for (let i = 0; i < aiCount; i++) {
      const angle = offset + (i / aiCount) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const radius = GAME.aiSpawnRadius + (rng() - 0.5) * 2 * GAME.aiSpawnJitter;
      const target = {
        tx: spawns[0].tx + Math.round(Math.cos(angle) * radius),
        ty: spawns[0].ty + Math.round(Math.sin(angle) * radius),
      };
      spawns.push({ villageId: `ai-${i + 1}`, ...this.findGoodSpot(target) });
    }
    return spawns;
  }
}
