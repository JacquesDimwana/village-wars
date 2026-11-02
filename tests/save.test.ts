import { describe, expect, it } from 'vitest';
import { addBuilding, addUnit, createGameState } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import {
  SAVE_KEY,
  clearSave,
  deserialize,
  loadGame,
  saveGame,
  serialize,
  type KeyValueStore,
} from '../src/core/SaveGame';
import { FogSystem, isExplored } from '../src/systems/FogSystem';
import { WorldGen } from '../src/world/WorldGen';

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const playedState = () => {
  const state = createGameState(new WorldGen(42));
  addBuilding(state, 'lumberCamp', PLAYER_ID, 3, 4, true);
  addUnit(state, 'knight', PLAYER_ID, 1.5, 2.5);
  new FogSystem().update(state, 100);
  state.timeMs = 123_400;
  state.stats.unitsTrained = 1;
  return state;
};

describe('SaveGame', () => {
  it('round-trips the whole state, fog bitmaps included', () => {
    const state = playedState();
    const back = deserialize(serialize(state))!;
    expect(back).toEqual(state);
    const key = Object.keys(state.fog.explored)[0];
    expect(back.fog.explored[key]).toBeInstanceOf(Uint8Array);
    expect(back.fog.explored[key].length).toBe(state.fog.explored[key].length);
    expect(isExplored(back.fog, 3, 4)).toBe(isExplored(state.fog, 3, 4));
  });

  it('saves, loads and clears through a store', () => {
    const store = memoryStore();
    const state = playedState();
    expect(saveGame(state, store)).toBe(true);
    expect(store.data.has(SAVE_KEY)).toBe(true);
    expect(loadGame(state.seed, store)?.timeMs).toBe(123_400);
    clearSave(store);
    expect(loadGame(state.seed, store)).toBeNull();
  });

  it('rejects corrupt saves, other seeds and broken storage', () => {
    const state = playedState();
    expect(deserialize('{nope')).toBeNull();
    expect(deserialize(JSON.stringify({ version: 999, state }))).toBeNull();
    expect(deserialize(serialize(state), state.seed + 1)).toBeNull();
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveGame(state, broken)).toBe(false);
    expect(loadGame(undefined, broken)).toBeNull();
    expect(() => clearSave(broken)).not.toThrow();
    expect(saveGame(state, null)).toBe(false);
  });
});
