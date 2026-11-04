import { describe, expect, it } from 'vitest';
import { BUILDINGS, COUNTER_MULTIPLIER, UNITS } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { addBuilding, addUnit, createGameState, townHallOf } from '../src/core/GameState';
import type { GameState, TileType } from '../src/core/types';
import { ArmySystem } from '../src/systems/ArmySystem';
import { CombatSystem, hitDamage, orderAttack, resolveTarget } from '../src/systems/CombatSystem';
import { VictorySystem } from '../src/systems/VictorySystem';
import { MovementSystem } from '../src/systems/MovementSystem';
import { spawnVillager } from '../src/systems/VillagerSystem';
import { WorldGen } from '../src/world/WorldGen';

/** Real village spawns; everything beyond x = 500 is open grass for the fights. */
const setup = () => {
  const world = new WorldGen(42);
  const state = createGameState(world);
  const tile = (tx: number, ty: number): TileType => (tx > 500 ? 'grass' : world.getTile(tx, ty));
  const movement = new MovementSystem(tile);
  const bus = new EventBus();
  const events: string[] = [];
  bus.on('building:destroyed', () => events.push('building:destroyed'));
  bus.on('village:destroyed', ({ villageId }) => events.push(`village:destroyed:${villageId}`));
  bus.on('game:over', ({ status }) => events.push(`game:over:${status}`));
  const combat = new CombatSystem(movement, bus);
  const army = new ArmySystem(movement);
  const victory = new VictorySystem(bus);
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 10; i++) {
      state.timeMs += 100;
      army.update(state, 100);
      combat.update(state, 100);
      victory.update(state);
      movement.update(state, 100);
    }
  };
  return { state, movement, combat, run, events };
};

const AI = 'ai-1';
const missionAt = (state: GameState, type: 'knight' | 'archer', owner: string, x: number, y: number) => {
  const u = addUnit(state, type, owner, x, y);
  u.onMission = true; // standing on the field, not resting in a camp
  return u;
};

describe('Combat damage', () => {
  it('knights deal ×1.5 to archers and to buildings, archers deal base damage', () => {
    const { state } = setup();
    const knight = addUnit(state, 'knight', PLAYER_ID, 1000, 1000);
    const archer = addUnit(state, 'archer', AI, 1001, 1000);
    const otherKnight = addUnit(state, 'knight', AI, 1002, 1000);
    const hall = townHallOf(state, AI)!;
    expect(hitDamage(knight, resolveTarget(state, archer.id)!)).toBe(UNITS.knight.attack * COUNTER_MULTIPLIER);
    expect(hitDamage(knight, resolveTarget(state, otherKnight.id)!)).toBe(UNITS.knight.attack);
    expect(hitDamage(knight, resolveTarget(state, hall.id)!)).toBe(UNITS.knight.attack * 1.5);
    expect(hitDamage(archer, resolveTarget(state, knight.id)!)).toBe(UNITS.archer.attack);
  });

  it('a knight kills an archer one-on-one and the archer leaves state.units', () => {
    const { state, run } = setup();
    const knight = missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    const archer = missionAt(state, 'archer', AI, 1003, 1000);
    run(10);
    expect(state.units[archer.id]).toBeUndefined();
    expect(state.units[knight.id]).toBeDefined();
    expect(knight.hp).toBeLessThan(knight.maxHp);
  });
});

describe('Ranges', () => {
  it('an archer shoots from its range without walking up to the target', () => {
    const { state, run } = setup();
    const archer = missionAt(state, 'archer', PLAYER_ID, 1000, 1000);
    const target = missionAt(state, 'knight', AI, 1000 + UNITS.archer.range, 1000);
    target.targetId = null;
    target.hp = 10_000; target.maxHp = 10_000; // keep it alive, and let it stand still
    target.nextAttackMs = Infinity;
    run(0.2);
    expect(archer.lastAttackMs).toBeGreaterThan(0);
    expect(archer.x).toBe(1000);
    expect(target.hp).toBe(10_000 - UNITS.archer.attack);
  });

  it('a knight must walk into melee range before hitting', () => {
    const { state, run } = setup();
    const knight = missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    const dummy = missionAt(state, 'archer', AI, 1005, 1000);
    dummy.hp = 10_000;
    dummy.nextAttackMs = Infinity;
    run(0.2);
    expect(dummy.hp).toBe(10_000);
    expect(knight.path.length).toBeGreaterThan(0);
    run(3);
    expect(dummy.hp).toBeLessThan(10_000);
    expect(Math.hypot(knight.x - dummy.x, knight.y - dummy.y)).toBeLessThanOrEqual(UNITS.knight.range + 0.5);
  });

  it('a warrior hitting a building turns on an enemy warrior coming close', () => {
    const { state, run } = setup();
    const house = addBuilding(state, 'house', AI, 1000, 1000, true);
    house.hp = 100_000;
    const knight = missionAt(state, 'knight', PLAYER_ID, 999, 1000);
    run(0.2);
    expect(knight.targetId).toBe(house.id);
    const guard = missionAt(state, 'archer', AI, 999, 1004);
    guard.nextAttackMs = Infinity;
    run(0.2);
    expect(knight.targetId).toBe(guard.id);
  });

  it('enemies beyond aggroRange are ignored', () => {
    const { state, run } = setup();
    const knight = missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    missionAt(state, 'archer', AI, 1000 + UNITS.knight.aggroRange + 2, 1000).nextAttackMs = Infinity;
    run(1);
    expect(knight.targetId).toBeNull();
  });

  it('a defense tower shoots enemies in range', () => {
    const { state, run } = setup();
    const tower = addBuilding(state, 'tower', PLAYER_ID, 1000, 1000, true);
    const enemy = missionAt(state, 'knight', AI, 1003, 1000);
    enemy.nextAttackMs = Infinity;
    run(0.1);
    expect(tower.targetId).toBe(enemy.id);
    expect(enemy.hp).toBe(enemy.maxHp - BUILDINGS.tower.attack!);
  });
});

describe('Allies and orders', () => {
  it('allied soldiers never fight each other', () => {
    const { state, run } = setup();
    state.villages[PLAYER_ID].allies.push(AI);
    state.villages[AI].allies.push(PLAYER_ID);
    const a = missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    const b = missionAt(state, 'archer', AI, 1001, 1000);
    run(5);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBe(b.maxHp);
    expect(orderAttack(state, [a.id], b.id)).toBe(0);
  });

  it('an ordered attack chases a target far beyond aggroRange', () => {
    const { state, run } = setup();
    const knight = missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    const far = missionAt(state, 'archer', AI, 1020, 1000);
    far.nextAttackMs = Infinity;
    expect(orderAttack(state, [knight.id], far.id)).toBe(1);
    run(16);
    expect(state.units[far.id]).toBeUndefined();
  });

  it('villagers are attacked and die (one inhabitant less)', () => {
    const { state, run } = setup();
    const v = spawnVillager(state, AI, 1001, 1000);
    missionAt(state, 'knight', PLAYER_ID, 1000, 1000);
    run(8);
    expect(state.villagers[v.id]).toBeUndefined();
  });
});

describe('Defense', () => {
  it('resting warriors of an attacked village come out and defend', () => {
    const { state, run } = setup();
    // AI barracks yard far from the town halls; its knight rests there.
    addBuilding(state, 'barracks', AI, 1000, 1000, true);
    const defender = addUnit(state, 'knight', AI, 1001, 1004);
    run(3); // settles at its rest slot
    expect(defender.onMission).toBe(false);
    // A player archer shoots a villager from beyond the defender's aggroRange.
    const villager = spawnVillager(state, AI, 1008, 1004);
    villager.hp = 10_000;
    const raider = missionAt(state, 'archer', PLAYER_ID, 1008 + UNITS.archer.range, 1004);
    raider.hp = 10_000;
    run(0.2);
    expect(Math.hypot(defender.x - raider.x, defender.y - raider.y)).toBeGreaterThan(UNITS.knight.aggroRange);
    run(1);
    expect(defender.targetId).toBe(raider.id);
    run(8);
    expect(Math.hypot(defender.x - raider.x, defender.y - raider.y)).toBeLessThan(2);
  });
});

describe('End of game', () => {
  const moveHall = (state: GameState, owner: string, tx: number, ty: number) => {
    const hall = townHallOf(state, owner)!;
    hall.tx = tx;
    hall.ty = ty;
    hall.hp = 1;
    return hall;
  };

  it('destroying the last enemy town hall wins the game', () => {
    const { state, run, events } = setup();
    for (const v of Object.values(state.villages)) {
      if (v.id === PLAYER_ID || v.id === AI) continue;
      v.alive = false;
      delete state.buildings[townHallOf(state, v.id)!.id];
    }
    const hall = moveHall(state, AI, 1000, 1000);
    missionAt(state, 'knight', PLAYER_ID, 999, 1000);
    run(2);
    expect(state.buildings[hall.id]).toBeUndefined();
    expect(state.villages[AI].alive).toBe(false);
    expect(events).toEqual(['building:destroyed', `village:destroyed:${AI}`, 'game:over:won']);
    expect(state.status).toBe('won');
  });

  it('breaks alliances when only allies remain', () => {
    const { state, run } = setup();
    for (const v of Object.values(state.villages)) {
      if (v.id === PLAYER_ID || v.id === AI) continue;
      state.villages[PLAYER_ID].allies.push(v.id);
      v.allies.push(PLAYER_ID);
    }
    moveHall(state, AI, 1000, 1000);
    missionAt(state, 'knight', PLAYER_ID, 999, 1000);
    run(2);
    expect(state.status).toBe('playing');
    expect(state.villages[PLAYER_ID].allies).toEqual([]);
  });

  it('losing the player town hall loses the game', () => {
    const { state, run, events } = setup();
    moveHall(state, PLAYER_ID, 1000, 1000);
    missionAt(state, 'knight', AI, 999, 1000);
    run(2);
    expect(state.villages[PLAYER_ID].alive).toBe(false);
    expect(state.status).toBe('lost');
    expect(events).toContain('game:over:lost');
  });

  it('other buildings are destroyed without ending the game', () => {
    const { state, run, events } = setup();
    const house = addBuilding(state, 'house', AI, 1000, 1000, true);
    house.hp = 1;
    missionAt(state, 'knight', PLAYER_ID, 999, 1000);
    run(2);
    expect(state.buildings[house.id]).toBeUndefined();
    expect(events).toEqual(['building:destroyed']);
    expect(state.status).toBe('playing');
  });
});
