import { describe, expect, it } from 'vitest';
import { GAME } from '../src/core/config';
import { createGameState } from '../src/core/GameState';
import { WorldGen, isBuildable } from '../src/world/WorldGen';

describe('WorldGen', () => {
  it('is deterministic for a given seed', () => {
    const a = new WorldGen(123);
    const b = new WorldGen(123);
    for (let i = -50; i < 50; i += 7) {
      expect(a.getTile(i, i * 2)).toBe(b.getTile(i, i * 2));
    }
    expect(a.spawns).toEqual(b.spawns);
  });

  it('spawns the player and 5 AI villages far from each other', () => {
    const w = new WorldGen(GAME.seed);
    expect(w.spawns).toHaveLength(1 + GAME.aiCount);
    const player = w.spawns[0];
    for (const ai of w.spawns.slice(1)) {
      const d = Math.hypot(ai.tx - player.tx, ai.ty - player.ty);
      expect(d).toBeGreaterThan(40);
    }
  });

  it('every town hall area is buildable land', () => {
    for (const seed of [1, 7, 1337, 9999]) {
      const w = new WorldGen(seed);
      for (const s of w.spawns) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) expect(isBuildable(w.getTile(s.tx + dx, s.ty + dy))).toBe(true);
        }
      }
    }
  });

  it('produces every terrain type somewhere', () => {
    const w = new WorldGen(GAME.seed);
    const seen = new Set<string>();
    for (let y = -150; y < 150; y += 2) for (let x = -150; x < 150; x += 2) seen.add(w.rawTile(x, y));
    expect([...seen].sort()).toEqual(['forest', 'grass', 'ore', 'rock', 'sand', 'water']);
  });

  it('creates one town hall and the starting inhabitants per village', () => {
    const state = createGameState(new WorldGen(GAME.seed));
    expect(Object.keys(state.villages)).toHaveLength(6);
    const halls = Object.values(state.buildings).filter((b) => b.type === 'townHall');
    expect(halls).toHaveLength(6);
    expect(Object.values(state.units)).toHaveLength(0);
    for (const v of Object.values(state.villages)) expect(v.inhabitants).toBe(GAME.startingInhabitants);
  });
});
