import { describe, expect, it } from 'vitest';
import { BUILDINGS, RESOURCES, VILLAGER } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { addBuilding, createGameState } from '../src/core/GameState';
import type { BuildingType } from '../src/core/types';
import { ArmorySystem, queueWeapon } from '../src/systems/ArmorySystem';
import { EconomySystem, canAfford, spend } from '../src/systems/EconomySystem';
import {
  PopulationSystem,
  assignWorkers,
  civilians,
  convertToWarrior,
  enlistableCount,
  housingCap,
  warriors,
} from '../src/systems/PopulationSystem';
import { WorldGen } from '../src/world/WorldGen';

const TICK = 100;

interface Milestones {
  firstHouse?: number;
  lumberCamp?: number;
  quarry?: number;
  armory?: number;
  army8?: number;
  pop40?: number;
  pop100?: number;
}

/**
 * A reasonable player, minute by minute: houses whenever housing is nearly full,
 * producers first, then iron and the army. Construction is emulated (agent A owns it):
 * a building pays its cost, then completes after `buildTimeMs`.
 */
function simulate(minutes: number): Milestones {
  const state = createGameState(new WorldGen(7));
  const v = state.villages[PLAYER_ID];
  const pop = new PopulationSystem();
  const eco = new EconomySystem();
  const armory = new ArmorySystem();
  const m: Milestones = {};
  let slot = 0;
  const done = (type: BuildingType) =>
    Object.values(state.buildings).filter((b) => b.ownerId === PLAYER_ID && b.type === type && b.buildProgress >= 1).length;
  const all = (type: BuildingType) =>
    Object.values(state.buildings).filter((b) => b.ownerId === PLAYER_ID && b.type === type).length;
  const tryBuild = (type: BuildingType): boolean => {
    if (!canAfford(v, BUILDINGS[type].cost)) return false;
    spend(v, BUILDINGS[type].cost);
    slot++;
    // Far from the AI villages; placement rules are not what this test checks.
    addBuilding(state, type, PLAYER_ID, 200 + (slot % 8) * 5, 200 + Math.floor(slot / 8) * 5, false);
    return true;
  };
  const building = () => Object.values(state.buildings).some((b) => b.ownerId === PLAYER_ID && b.buildProgress < 1);
  const order: BuildingType[] = ['lumberCamp', 'quarry', 'mine', 'smelter', 'armory', 'barracks', 'armyCamp'];

  for (let t = 0; t < minutes * 60_000; t += TICK) {
    state.timeMs = t;
    for (const b of Object.values(state.buildings)) {
      if (b.buildProgress < 1) b.buildProgress = Math.min(1, b.buildProgress + TICK / BUILDINGS[b.type].buildTimeMs);
    }
    pop.update(state, TICK);
    eco.update(state, TICK);
    armory.update(state, TICK);

    // One builder at a time (the village has one construction site).
    if (!building()) {
      const total = civilians(state, PLAYER_ID) + warriors(state, PLAYER_ID).length;
      const cap = housingCap(state, PLAYER_ID);
      const next = order.find((type) => all(type) === 0);
      const idle = civilians(state, PLAYER_ID) - [...assignWorkers(state, PLAYER_ID).values()].reduce((a, b) => a + b, 0);
      if (total >= cap * 0.9) tryBuild('house');
      else if (next) tryBuild(next);
      else if (idle >= 3) tryBuild(all('lumberCamp') <= all('quarry') + 1 ? 'lumberCamp' : 'quarry');
      else if (total >= cap * 0.8) tryBuild('house');
    }
    // Army: keep 2 weapons in the forge queue, train when possible (keep a working core).
    if (done('armory') > 0 && v.forgeQueue.length < 2 && v.weapons.sword + v.weapons.bow < 3) queueWeapon(state, PLAYER_ID, v.resources.iron >= 10 ? 'sword' : 'bow');
    if (done('barracks') > 0 && enlistableCount(state, PLAYER_ID) > 6) {
      if (v.weapons.sword > 0) convertToWarrior(state, PLAYER_ID, 'knight');
      else if (v.weapons.bow > 0) convertToWarrior(state, PLAYER_ID, 'archer');
    }

    const sec = t / 1000;
    m.firstHouse ??= done('house') > 0 ? sec : undefined;
    m.lumberCamp ??= done('lumberCamp') > 0 ? sec : undefined;
    m.quarry ??= done('quarry') > 0 ? sec : undefined;
    m.armory ??= done('armory') > 0 ? sec : undefined;
    m.army8 ??= warriors(state, PLAYER_ID).length >= 8 ? sec : undefined;
    const people = civilians(state, PLAYER_ID) + warriors(state, PLAYER_ID).length;
    m.pop40 ??= people >= 40 ? sec : undefined;
    m.pop100 ??= people >= 100 ? sec : undefined;
  }
  return m;
}

const minutes = (s: number | undefined): number => (s ?? Infinity) / 60;

describe('Game pacing (15-25 min game)', () => {
  const m = simulate(20);

  it('logs the milestones (minutes)', () => {
    console.log(`pacing ${JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, s]) => [k, +(s / 60).toFixed(1)])))}`);
  });

  it('first house around 1 min', () => expect(minutes(m.firstHouse)).toBeLessThanOrEqual(1.3));
  it('lumber camp and quarry before 3 min', () => {
    expect(minutes(m.lumberCamp)).toBeLessThan(3);
    expect(minutes(m.quarry)).toBeLessThan(3);
  });
  it('armory (50 iron) around 6-9 min', () => {
    expect(minutes(m.armory)).toBeGreaterThanOrEqual(6 * 0.7);
    expect(minutes(m.armory)).toBeLessThanOrEqual(9 * 1.3);
  });
  it('about 8 warriors around 10-13 min', () => {
    expect(minutes(m.army8)).toBeGreaterThanOrEqual(10 * 0.7);
    expect(minutes(m.army8)).toBeLessThanOrEqual(13 * 1.3);
  });
  it('about 40 inhabitants around 8 min, 100 around 14-16 min', () => {
    expect(minutes(m.pop40)).toBeGreaterThanOrEqual(8 * 0.7);
    expect(minutes(m.pop40)).toBeLessThanOrEqual(8 * 1.3);
    expect(minutes(m.pop100)).toBeGreaterThanOrEqual(14 * 0.7);
    expect(minutes(m.pop100)).toBeLessThanOrEqual(16 * 1.3);
  });
});

describe('Manual harvest rate', () => {
  /** Units per second for one villager gathering `d` tiles from its depot (walk both ways). */
  const rate = (d: number) => {
    const cycle = VILLAGER.carryCapacity / VILLAGER.gatherPerSecond + (2 * d) / VILLAGER.speed;
    return VILLAGER.carryCapacity / cycle;
  };

  it('is close to one staffed job (0.3-0.45/s at 2-6 tiles) and drops with distance', () => {
    expect(rate(2)).toBeLessThanOrEqual(0.45);
    expect(rate(6)).toBeGreaterThanOrEqual(0.3);
    expect(rate(10)).toBeLessThan(rate(2));
    // Never clearly better than a lumber camp worker.
    const perWorker = BUILDINGS.lumberCamp.produces!.wood! / BUILDINGS.lumberCamp.workerSlots!;
    expect(rate(2)).toBeLessThanOrEqual(perWorker * 1.15);
  });

  it('empties a 150-wood forest tile in 5-7 min', () => {
    const minutesToEmpty = RESOURCES.tileAmounts.forest / rate(4) / 60;
    expect(minutesToEmpty).toBeGreaterThanOrEqual(5);
    expect(minutesToEmpty).toBeLessThanOrEqual(7);
  });
});
