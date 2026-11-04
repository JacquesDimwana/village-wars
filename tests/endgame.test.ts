import { describe, expect, it } from 'vitest';
import { addBuilding, addUnit, createGameState, townHallOf } from '../src/core/GameState';
import { EventBus } from '../src/core/EventBus';
import { PLAYER_ID } from '../src/core/constants';
import { GAME } from '../src/core/config';
import type { GameState } from '../src/core/types';
import { GatherSystem } from '../src/systems/GatherSystem';
import { MovementSystem } from '../src/systems/MovementSystem';
import { TrainingSystem, queueTraining } from '../src/systems/TrainingSystem';
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
  it('counts resources deposited by a villager', () => {
    const { bus, state, tick } = setup();
    const hall = townHallOf(state, PLAYER_ID)!;
    const villager = Object.values(state.villagers).find(v => v.ownerId === PLAYER_ID)!;
    villager.x = hall.tx; villager.y = hall.ty + 3;
    villager.harvest = { tx: 999, ty: 999, sourceType: 'berry' };
    villager.task = 'returning'; villager.path = []; villager.carrying = { type: 'food', amount: 7 };
    new GatherSystem(new MovementSystem(() => 'grass'), bus).update(state, 100);
    tick();
    expect(state.stats.resourcesGathered).toBe(7);
  });

  it('counts completed villager and soldier training, not starting or debug units', () => {
    const { bus, state, tick } = setup();
    const hall = townHallOf(state, PLAYER_ID)!;
    const movement = new MovementSystem(() => 'grass');
    expect(queueTraining(state, hall.id, 'villager')).toBe(true);
    new TrainingSystem(movement, bus).update(state, 20000);
    tick(); tick();
    expect(state.stats.unitsTrained).toBe(1);
    addUnit(state, 'knight', PLAYER_ID, 0, 0);
    addBuilding(state, 'house', PLAYER_ID, 15, 15, true);
    const barracks = addBuilding(state, 'barracks', PLAYER_ID, 10, 10, true);
    expect(queueTraining(state, barracks.id, 'spearman')).toBe(true);
    new TrainingSystem(movement, bus).update(state, 18000);
    tick();
    expect(state.stats.unitsTrained).toBe(2);
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

