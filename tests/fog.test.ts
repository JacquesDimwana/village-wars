import { describe, expect, it } from 'vitest';
import { addBuilding, addUnit, createGameState, townHallOf } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import { BUILDINGS, GAME, UNITS } from '../src/core/config';
import { FogSystem, isExplored, isVisible, reveal, updateVision } from '../src/systems/FogSystem';
import { WorldGen } from '../src/world/WorldGen';

const setup = () => {
  const state = createGameState(new WorldGen(42));
  const hall = townHallOf(state, PLAYER_ID)!;
  const c = BUILDINGS.townHall.size / 2;
  return { state, hall, cx: hall.tx + c, cy: hall.ty + c };
};

describe('Exploration', () => {
  it('starts with nothing explored', () => {
    const { state, cx, cy } = setup();
    expect(isExplored(state.fog, Math.floor(cx), Math.floor(cy))).toBe(false);
  });

  it('reveal works across chunk borders and negative coordinates', () => {
    const { state } = setup();
    expect(reveal(state.fog, 0, 0, 3)).toBeGreaterThan(20);
    expect(isExplored(state.fog, -1, -1)).toBe(true);
    expect(isExplored(state.fog, 1, 1)).toBe(true);
    expect(isExplored(state.fog, 5, 0)).toBe(false);
    // Revealing the same area again adds nothing and keeps the version.
    const v = state.fog.version;
    expect(reveal(state.fog, 0, 0, 3)).toBe(0);
    expect(state.fog.version).toBe(v);
  });

  it('buildings reveal their vision on the first tick', () => {
    const { state, cx, cy } = setup();
    new FogSystem().update(state, 100);
    const vision = BUILDINGS.townHall.vision;
    expect(isExplored(state.fog, Math.floor(cx + vision - 1), Math.floor(cy))).toBe(true);
    expect(isExplored(state.fog, Math.floor(cx + vision + 3), Math.floor(cy))).toBe(false);
  });

  it('staffed producers explore further over time, up to maxRadius', () => {
    const { state, hall } = setup();
    const fog = new FogSystem();
    // Starting inhabitants all work at the town hall (its only job).
    for (let i = 0; i < 10; i++) fog.update(state, 1000);
    const vision = BUILDINGS.townHall.vision;
    expect(state.fog.radius[hall.id]).toBeCloseTo(vision + GAME.exploration.growthPerSecond * 10 * (3 / 3));
    for (let i = 0; i < 1000; i++) fog.update(state, 1000);
    expect(state.fog.radius[hall.id]).toBe(GAME.exploration.maxRadius);
  });

  it('exploration grows with the share of filled worker slots', () => {
    const { state } = setup();
    state.villages[PLAYER_ID].inhabitants = 1;
    const camp = addBuilding(state, 'lumberCamp', PLAYER_ID, 100, 100, true);
    new FogSystem().update(state, 4000);
    const def = BUILDINGS.lumberCamp;
    expect(state.fog.radius[camp.id]).toBeCloseTo(def.vision + GAME.exploration.growthPerSecond * 4 * (1 / def.workerSlots!));
  });

  it('non-producers and unfinished buildings only reveal their vision', () => {
    const { state } = setup();
    const house = addBuilding(state, 'house', PLAYER_ID, 50, 50, true);
    const camp = addBuilding(state, 'lumberCamp', PLAYER_ID, 60, 60, false);
    const fog = new FogSystem();
    for (let i = 0; i < 20; i++) fog.update(state, 1000);
    expect(state.fog.radius[house.id]).toBe(BUILDINGS.house.vision);
    expect(state.fog.radius[camp.id]).toBe(BUILDINGS.lumberCamp.vision);
  });

  it('AI buildings do not explore for the player', () => {
    const { state } = setup();
    const ai = townHallOf(state, 'ai-1')!;
    new FogSystem().update(state, 100);
    expect(isExplored(state.fog, ai.tx, ai.ty)).toBe(false);
  });
});

describe('Current vision (fog of war)', () => {
  it('town hall vision is visible, its foraging radius is only explored', () => {
    const { state, cx, cy } = setup();
    const fog = new FogSystem();
    for (let i = 0; i < 60; i++) fog.update(state, 1000);
    const vision = BUILDINGS.townHall.vision;
    expect(isVisible(state.fog, Math.floor(cx + vision - 1), Math.floor(cy))).toBe(true);
    const far = Math.floor(cx + vision + 3);
    expect(isExplored(state.fog, far, Math.floor(cy))).toBe(true);
    expect(isVisible(state.fog, far, Math.floor(cy))).toBe(false);
  });

  it('follows warriors: tiles they leave stay explored but not visible', () => {
    const { state } = setup();
    const u = addUnit(state, 'knight', PLAYER_ID, 200, 200);
    new FogSystem().update(state, 100);
    expect(isVisible(state.fog, 200, 200)).toBe(true);
    u.x = 260;
    new FogSystem().update(state, 100);
    expect(isVisible(state.fog, 260, 200)).toBe(true);
    expect(isVisible(state.fog, 200, 200)).toBe(false);
    expect(isExplored(state.fog, 200, 200)).toBe(true);
    expect(isVisible(state.fog, Math.floor(260 + UNITS.knight.vision + 1), 200)).toBe(false);
  });

  it('skips recomputing while nothing changed tile', () => {
    const { state } = setup();
    const u = addUnit(state, 'archer', PLAYER_ID, 10, 10);
    expect(updateVision(state)).toBe(true);
    const v = state.fog.visionVersion;
    expect(updateVision(state)).toBe(false);
    u.x += 0.1;
    expect(updateVision(state)).toBe(false);
    u.x += 1;
    expect(updateVision(state)).toBe(true);
    expect(state.fog.visionVersion).toBe(v + 1);
  });

  it('enemy units give no vision to the player', () => {
    const { state } = setup();
    addUnit(state, 'knight', 'ai-1', 300, 300);
    updateVision(state);
    expect(isVisible(state.fog, 300, 300)).toBe(false);
  });
});
