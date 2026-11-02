import type { GameState, TileType } from '../core/types';
import { isBuildable, type WorldGen } from './WorldGen';

const HARVESTABLE: ReadonlySet<TileType> = new Set(['forest', 'rock', 'iron']);

export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

/**
 * Terrain as it is now: a forest / rock / iron tile whose resource has been used up
 * (`state.depletion` ≤ 0) is cleared and becomes grass. Water never changes.
 */
export function currentTile(state: GameState, world: WorldGen, tx: number, ty: number): TileType {
  const tile = world.getTile(tx, ty);
  if (HARVESTABLE.has(tile) && (state.depletion[tileKey(tx, ty)] ?? Infinity) <= 0) return 'grass';
  return tile;
}

/** Only grass / sand can be built on: trees, rocks, iron and water block until cleared. */
export function canBuildOnTile(state: GameState, world: WorldGen, tx: number, ty: number): boolean {
  return isBuildable(currentTile(state, world, tx, ty));
}
