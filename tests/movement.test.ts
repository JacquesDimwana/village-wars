import { describe, expect, it } from 'vitest';
import { addBuilding, addUnit, createGameState } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import type { TileType } from '../src/core/types';
import { MovementSystem, findPath, tileOf } from '../src/systems/MovementSystem';
import { WorldGen } from '../src/world/WorldGen';

/** Flat grass world far from every village, with optional water tiles. */
const world = (water: (tx: number, ty: number) => boolean = () => false) => (tx: number, ty: number): TileType =>
  water(tx, ty) ? 'water' : 'grass';

const setup = (water?: (tx: number, ty: number) => boolean) => {
  const state = createGameState(new WorldGen(42));
  state.villagers = {};
  return { state, movement: new MovementSystem(world(water)) };
};

const walk = (movement: MovementSystem, state: ReturnType<typeof setup>['state'], seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) movement.update(state, 100);
};

describe('A* pathfinding', () => {
  it('finds a straight path on open ground (goal included, start excluded)', () => {
    const path = findPath(() => true, { tx: 0, ty: 0 }, (x, y) => x === 5 && y === 0, { tx: 5, ty: 0 });
    expect(path).toHaveLength(5);
    expect(path[4]).toEqual({ tx: 5, ty: 0 });
  });

  it('goes around a water wall and never steps on water', () => {
    const isWater = (tx: number, ty: number) => tx === 3 && ty >= -5 && ty <= 5;
    const path = findPath((x, y) => !isWater(x, y), { tx: 0, ty: 0 }, (x, y) => x === 6 && y === 0, { tx: 6, ty: 0 });
    expect(path.at(-1)).toEqual({ tx: 6, ty: 0 });
    expect(path.some((p) => isWater(p.tx, p.ty))).toBe(false);
    expect(path.length).toBeGreaterThan(6);
  });

  it('does not cut corners between two blocked tiles', () => {
    const blocked = new Set(['1,0', '0,1']);
    const path = findPath((x, y) => !blocked.has(`${x},${y}`), { tx: 0, ty: 0 }, (x, y) => x === 1 && y === 1, { tx: 1, ty: 1 });
    // The diagonal (0,0)→(1,1) squeezes between the two blocks: forbidden, so it walks around.
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).not.toEqual({ tx: 1, ty: 1 });
  });

  it('stops at the closest reachable tile when the goal is unreachable (bounded search)', () => {
    const island = (tx: number, ty: number) => Math.abs(tx - 10) <= 1 && Math.abs(ty) <= 1 ? false : tx >= 8;
    const path = findPath((x, y) => !island(x, y) || (x === 10 && y === 0), { tx: 0, ty: 0 }, (x, y) => x === 10 && y === 0, { tx: 10, ty: 0 }, 500);
    expect(path.at(-1)!.tx).toBe(7);
  });
});

describe('MovementSystem', () => {
  it('walks a unit to its destination around water', () => {
    const { state, movement } = setup((tx, ty) => tx === 1003 && ty >= 995 && ty <= 1005);
    const u = addUnit(state, 'knight', PLAYER_ID, 1000, 1000);
    movement.moveTo(state, u, 1006, 1000);
    walk(movement, state, 10);
    expect(tileOf(u)).toEqual({ tx: 1006, ty: 1000 });
  });

  it('buildings block the way', () => {
    const { state, movement } = setup();
    addBuilding(state, 'barracks', PLAYER_ID, 1002, 999, true); // 3×3 wall across the straight line
    const u = addUnit(state, 'knight', PLAYER_ID, 1000, 1000);
    movement.moveTo(state, u, 1006, 1000);
    expect(u.path.some((p) => p.tx >= 1002 && p.tx <= 1004 && p.ty >= 999 && p.ty <= 1001)).toBe(false);
  });

  it('a group sent to one tile spreads over distinct tiles (no stacking)', () => {
    const { state, movement } = setup();
    const units = Array.from({ length: 9 }, (_, i) => addUnit(state, 'archer', PLAYER_ID, 1000 + i, 1000));
    const spots = movement.moveGroup(state, units, 1010, 1010);
    expect(new Set(spots.map((s) => `${s.tx},${s.ty}`)).size).toBe(9);
    walk(movement, state, 20);
    expect(new Set(units.map((u) => `${tileOf(u).tx},${tileOf(u).ty}`)).size).toBe(9);
  });

  it('allies walk through each other, enemies push apart', () => {
    const { state, movement } = setup();
    const a = addUnit(state, 'knight', PLAYER_ID, 1000, 1000);
    const b = addUnit(state, 'knight', PLAYER_ID, 1000.1, 1000);
    walk(movement, state, 1);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(0.1, 5);
    const enemy = addUnit(state, 'knight', 'ai-1', 1000.1, 1000.05);
    walk(movement, state, 2);
    expect(Math.hypot(a.x - enemy.x, a.y - enemy.y)).toBeGreaterThan(0.3);
  });

  it('a building placed on a unit pushes it to the nearest free tile', () => {
    const { state, movement } = setup();
    const u = addUnit(state, 'knight', PLAYER_ID, 1001, 1001);
    walk(movement, state, 0.1);
    const house = addBuilding(state, 'house', PLAYER_ID, 1000, 1000, false);
    walk(movement, state, 0.1);
    const t = tileOf(u);
    const inside = t.tx >= house.tx && t.tx < house.tx + 2 && t.ty >= house.ty && t.ty < house.ty + 2;
    expect(inside).toBe(false);
    expect(movement.walkable(state, t.tx, t.ty)).toBe(true);
  });
});
