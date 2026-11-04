import { BUILDINGS, GAME, UNITS, VILLAGER } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { FogState, GameState } from '../core/types';

const CHUNK = GAME.chunkSize;

const chunkKey = (tx: number, ty: number): string => `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`;
const indexInChunk = (tx: number, ty: number): number =>
  (((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((tx % CHUNK) + CHUNK) % CHUNK);

export function isExplored(fog: FogState, tx: number, ty: number): boolean {
  return fog.explored[chunkKey(tx, ty)]?.[indexInChunk(tx, ty)] === 1;
}

/** True when the tile is in the player's current vision (buildings + warriors). */
export function isVisible(fog: FogState, tx: number, ty: number): boolean {
  return fog.visible[chunkKey(tx, ty)]?.[indexInChunk(tx, ty)] === 1;
}

/** Sets every tile within `radius` of (cx, cy) to 1 in `layer`. Returns how many tiles were new. */
function paint(layer: Record<string, Uint8Array>, cx: number, cy: number, radius: number): number {
  const r = Math.floor(radius);
  const r2 = radius * radius;
  let added = 0;
  for (let ty = Math.floor(cy - r); ty <= Math.ceil(cy + r); ty++) {
    for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
      if (tx < -GAME.map.halfSize || tx >= GAME.map.halfSize || ty < -GAME.map.halfSize || ty >= GAME.map.halfSize) continue;
      const dx = tx + 0.5 - cx;
      const dy = ty + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const key = chunkKey(tx, ty);
      const bits = (layer[key] ??= new Uint8Array(CHUNK * CHUNK));
      const i = indexInChunk(tx, ty);
      if (bits[i] === 0) {
        bits[i] = 1;
        added++;
      }
    }
  }
  return added;
}

/** Marks every tile within `radius` of (cx, cy) as explored. Returns how many tiles were new. */
export function reveal(fog: FogState, cx: number, cy: number, radius: number): number {
  const added = paint(fog.explored, cx, cy, radius);
  if (added > 0) fog.version++;
  return added;
}

/** Vision circles of the player's buildings and warriors: [x, y, radius]. */
function visionSources(state: GameState): [number, number, number][] {
  const sources: [number, number, number][] = [];
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== PLAYER_ID && !state.villages[PLAYER_ID].allies.includes(b.ownerId)) continue;
    const def = BUILDINGS[b.type];
    sources.push([b.tx + def.size / 2, b.ty + def.size / 2, def.vision]);
  }
  for (const u of Object.values(state.units)) {
    if (u.ownerId === PLAYER_ID || state.villages[PLAYER_ID].allies.includes(u.ownerId)) sources.push([u.x + 0.5, u.y + 0.5, UNITS[u.type].vision]);
  }
  for (const v of Object.values(state.villagers)) {
    if (!v.inside && (v.ownerId === PLAYER_ID || state.villages[PLAYER_ID].allies.includes(v.ownerId))) sources.push([v.x + 0.5, v.y + 0.5, VILLAGER.vision]);
  }
  return sources;
}

/**
 * Recomputes the player's current vision. Skipped while no source changed tile
 * (warriors walking inside a tile don't trigger work). Returns true if it was recomputed.
 */
export function updateVision(state: GameState): boolean {
  const fog = state.fog;
  const sources = visionSources(state);
  const key = sources.map(([x, y, r]) => `${Math.floor(x * 2)},${Math.floor(y * 2)},${r}`).join(';');
  if (key === fog.visionKey) return false;
  fog.visionKey = key;
  for (const bits of Object.values(fog.visible)) bits.fill(0);
  for (const [x, y, r] of sources) paint(fog.visible, x, y, r);
  fog.visionVersion++;
  return true;
}

/** Explores tiles currently visible to the player and allied villages. */
export class FogSystem {
  update(state: GameState, _dtMs: number): void {
    if (updateVision(state)) {
      for (const [x, y, r] of visionSources(state)) reveal(state.fog, x, y, r);
    }
  }
}
