import { BUILDINGS, GAME, UNITS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { FogState, GameState } from '../core/types';
import { assignWorkers, staffing } from './PopulationSystem';

const CHUNK = GAME.chunkSize;

const chunkKey = (tx: number, ty: number): string => `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`;
const indexInChunk = (tx: number, ty: number): number =>
  (((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((tx % CHUNK) + CHUNK) % CHUNK);

export function isExplored(fog: FogState, tx: number, ty: number): boolean {
  return fog.explored[chunkKey(tx, ty)]?.[indexInChunk(tx, ty)] === 1;
}

/** Marks every tile within `radius` of (cx, cy) as explored. Returns how many tiles were new. */
export function reveal(fog: FogState, cx: number, cy: number, radius: number): number {
  const r = Math.floor(radius);
  const r2 = radius * radius;
  let added = 0;
  for (let ty = Math.floor(cy - r); ty <= Math.ceil(cy + r); ty++) {
    for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
      const dx = tx + 0.5 - cx;
      const dy = ty + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const key = chunkKey(tx, ty);
      const bits = (fog.explored[key] ??= new Uint8Array(CHUNK * CHUNK));
      const i = indexInChunk(tx, ty);
      if (bits[i] === 0) {
        bits[i] = 1;
        added++;
      }
    }
  }
  if (added > 0) fog.version++;
  return added;
}

/**
 * Player exploration. Every building reveals its `vision`; producers (town hall, lumber
 * camp, quarry, mine) send their workers further over time, proportionally to staffing.
 * Warriors reveal their `vision` around them.
 */
export class FogSystem {
  update(state: GameState, dtMs: number): void {
    const fog = state.fog;
    const { growthPerSecond, maxRadius } = GAME.exploration;
    const assignment = assignWorkers(state, PLAYER_ID);

    for (const b of Object.values(state.buildings)) {
      if (b.ownerId !== PLAYER_ID) continue;
      const def = BUILDINGS[b.type];
      const prev = fog.radius[b.id] ?? 0;
      let next = Math.max(prev, def.vision);
      if (def.produces && b.buildProgress >= 1) {
        next = Math.min(Math.max(maxRadius, def.vision), next + growthPerSecond * staffing(b, assignment) * (dtMs / 1000));
      }
      fog.radius[b.id] = next;
      // Re-reveal only when the radius crossed a half tile (cheap at 10 ticks/s).
      if (prev === 0 || Math.floor(next * 2) > Math.floor(prev * 2)) {
        reveal(fog, b.tx + def.size / 2, b.ty + def.size / 2, next);
      }
    }

    for (const u of Object.values(state.units)) {
      if (u.ownerId === PLAYER_ID) reveal(fog, u.x + 0.5, u.y + 0.5, UNITS[u.type].vision);
    }
  }
}
