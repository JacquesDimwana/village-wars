import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/core/GameState';
import type { TileType } from '../src/core/types';
import { WorldGen } from '../src/world/WorldGen';
import { canBuildOnTile, currentTile, tileKey } from '../src/world/tiles';

const world = new WorldGen(42);

/** First tile of a given type found near the origin. */
function find(type: TileType): { tx: number; ty: number } {
  for (let r = 0; r < 200; r++) {
    for (let ty = -r; ty <= r; ty++) {
      for (let tx = -r; tx <= r; tx++) if (world.getTile(tx, ty) === type) return { tx, ty };
    }
  }
  throw new Error(`no ${type} tile`);
}

describe('Buildable tiles', () => {
  it('trees, rocks, ore and water block construction', () => {
    const state = createGameState(world);
    for (const t of ['forest', 'rock', 'iron', 'water'] as TileType[]) {
      const { tx, ty } = find(t);
      expect(canBuildOnTile(state, world, tx, ty)).toBe(false);
    }
    const g = find('grass');
    expect(canBuildOnTile(state, world, g.tx, g.ty)).toBe(true);
  });

  it('a harvested-out tile becomes buildable grass', () => {
    const state = createGameState(world);
    const { tx, ty } = find('forest');
    state.depletion[tileKey(tx, ty)] = 20;
    expect(canBuildOnTile(state, world, tx, ty)).toBe(false);
    state.depletion[tileKey(tx, ty)] = 0;
    expect(currentTile(state, world, tx, ty)).toBe('grass');
    expect(canBuildOnTile(state, world, tx, ty)).toBe(true);
  });

  it('water stays unbuildable whatever the depletion data says', () => {
    const state = createGameState(world);
    const { tx, ty } = find('water');
    state.depletion[tileKey(tx, ty)] = 0;
    expect(canBuildOnTile(state, world, tx, ty)).toBe(false);
  });
});
