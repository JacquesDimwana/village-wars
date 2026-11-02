import { describe, expect, it } from 'vitest';
import { addUnit, createGameState, townHallOf } from '../src/core/GameState';
import { EventBus } from '../src/core/EventBus';
import { PLAYER_ID } from '../src/core/constants';
import { GAME } from '../src/core/config';
import type { GameState } from '../src/core/types';
import { EconomySystem } from '../src/systems/EconomySystem';
import { StatsSystem, victoryStars } from '../src/systems/StatsSystem';
import { VictorySystem } from '../src/systems/VictorySystem';
import { WorldGen } from '../src/world/WorldGen';

const setup = () => {
  const bus = new EventBus();
  const state = createGameState(new WorldGen(42));
  const events: string[] = [];
  bus.on('village:destroyed', ({ villageId }) => events.push(`destroyed:${villageId}`));
  bus.on('game:over', ({ status }) => events.push(`over:${status}`));
  const notes: string[] = [];
  bus.on('notify', ({ message }) => notes.push(message));
  const victory = new VictorySystem(bus);
  const stats = new StatsSystem(bus);
  const tick = () => {
    victory.update(state);
    stats.update(state);
  };
  return { bus, state, events, notes, tick };
};

const aiIds = (state: GameState) => Object.keys(state.villages).filter((id) => id !== PLAYER_ID);
const destroyHall = (state: GameState, villageId: string) => delete state.buildings[townHallOf(state, villageId)!.id];

describe('VictorySystem', () => {
  it('keeps playing while everyone has a town hall', () => {
    const { state, events, tick } = setup();
    tick();
    expect(state.status).toBe('playing');
    expect(events).toEqual([]);
  });

  it('eliminates a village whose town hall is destroyed (deleted or 0 HP)', () => {
    const { state, events, tick } = setup();
    const [a, b] = aiIds(state);
    destroyHall(state, a);
    townHallOf(state, b)!.hp = 0;
    tick();
    expect(state.villages[a].alive).toBe(false);
    expect(state.villages[b].alive).toBe(false);
    expect(events).toEqual([`destroyed:${a}`, `destroyed:${b}`]);
    expect(state.stats.villagesDestroyed).toBe(2);
    tick(); // no duplicate events
    expect(events.length).toBe(2);
  });

  it('loses when the player town hall is destroyed', () => {
    const { state, events, tick } = setup();
    destroyHall(state, PLAYER_ID);
    tick();
    expect(state.status).toBe('lost');
    expect(events).toEqual([`destroyed:${PLAYER_ID}`, 'over:lost']);
    expect(state.stats.villagesDestroyed).toBe(0);
  });

  it('wins when every enemy town hall is destroyed', () => {
    const { state, events, tick } = setup();
    for (const id of aiIds(state)) destroyHall(state, id);
    tick();
    expect(state.status).toBe('won');
    expect(events.at(-1)).toBe('over:won');
    expect(state.stats.villagesDestroyed).toBe(GAME.aiCount);
  });

  it('breaks alliances when only allies remain, then the game goes on', () => {
    const { state, notes, tick } = setup();
    const [ally, ...enemies] = aiIds(state);
    state.villages[PLAYER_ID].allies = [ally];
    state.villages[ally].allies = [PLAYER_ID];
    for (const id of enemies) destroyHall(state, id);
    tick();
    expect(state.status).toBe('playing');
    expect(state.villages[PLAYER_ID].allies).toEqual([]);
    expect(state.villages[ally].allies).toEqual([]);
    expect(notes.some((m) => m.includes('Il ne peut en rester'))).toBe(true);
    destroyHall(state, ally);
    tick();
    expect(state.status).toBe('won');
  });
});

describe('StatsSystem', () => {
  it('counts gathered resources from economy events', () => {
    const { bus, state, tick } = setup();
    const economy = new EconomySystem(bus);
    const total = () => Object.values(state.villages[PLAYER_ID].resources).reduce((a, b) => a + b, 0);
    const before = total();
    for (let i = 0; i < 100; i++) {
      economy.update(state, 100);
      tick();
    }
    const gained = total() - before;
    expect(gained).toBeGreaterThan(0);
    expect(state.stats.resourcesGathered).toBe(gained);
  });

  it('counts each new player unit once', () => {
    const { state, tick } = setup();
    addUnit(state, 'knight', PLAYER_ID, 0, 0);
    addUnit(state, 'archer', aiIds(state)[0], 0, 0);
    tick();
    tick();
    expect(state.stats.unitsTrained).toBe(1);
    addUnit(state, 'archer', PLAYER_ID, 0, 0);
    addUnit(state, 'archer', PLAYER_ID, 0, 0);
    tick();
    expect(state.stats.unitsTrained).toBe(3);
  });

  it('gives 1–3 stars on victory depending on time, 0 on defeat', () => {
    const { state } = setup();
    const [three, two] = GAME.endgame.victoryStarsMinutes;
    expect(victoryStars(state)).toBe(0);
    state.status = 'won';
    state.timeMs = three * 60000;
    expect(victoryStars(state)).toBe(3);
    state.timeMs = two * 60000;
    expect(victoryStars(state)).toBe(2);
    state.timeMs = (two + 1) * 60000;
    expect(victoryStars(state)).toBe(1);
  });
});

