import { describe, expect, it } from 'vitest';
import { AI, UNITS } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { addUnit, createGameState, townHallOf } from '../src/core/GameState';
import type { GameState, Personality } from '../src/core/types';
import {
  DiplomacySystem,
  allianceScore,
  areAllied,
  armyPower,
  breakAlliance,
  changeRelation,
  checkProposeAlliance,
  checkRequestReinforcements,
  proposeAlliance,
  relation,
  requestReinforcements,
  requestResources,
  sendResources,
} from '../src/systems/DiplomacySystem';
import { reveal } from '../src/systems/FogSystem';
import { WorldGen } from '../src/world/WorldGen';

const D = AI.diplomacy;

const setup = () => {
  const state = createGameState(new WorldGen(42));
  const bus = new EventBus();
  const events: string[] = [];
  bus.on('diplomacy:alliance', (e) => events.push(e.accepted ? 'accepted' : 'refused'));
  bus.on('diplomacy:lastStanding', () => events.push('lastStanding'));
  return { state, bus, events };
};

/** Explores the AI's town hall so the player can deal with it. */
const discover = (state: GameState, id: string): void => {
  const hall = townHallOf(state, id)!;
  reveal(state.fog, hall.tx + 1, hall.ty + 1, 3);
};

const villageWith = (state: GameState, personality: Personality): string => {
  const v = Object.values(state.villages).find((x) => x.personality === personality)!;
  discover(state, v.id);
  return v.id;
};

describe('Army power', () => {
  it('is the sum of HP × attack of military units', () => {
    const { state } = setup();
    addUnit(state, 'knight', PLAYER_ID, 0, 0);
    const archer = addUnit(state, 'archer', PLAYER_ID, 0, 0);
    archer.hp = 35;
    expect(armyPower(state, PLAYER_ID)).toBe(UNITS.knight.hp * UNITS.knight.attack + 35 * UNITS.archer.attack);
    expect(armyPower(state, 'ai-1')).toBe(0);
  });
});

describe('Alliance proposal', () => {
  it('needs the village to be discovered', () => {
    const { state, bus } = setup();
    const res = proposeAlliance(state, PLAYER_ID, 'ai-1', bus);
    expect(res).toEqual({ ok: false, reason: 'Village pas encore découvert' });
  });

  it('with equal (empty) armies: diplomat and economic accept, aggressive refuses', () => {
    const { state, bus } = setup();
    for (const p of ['diplomat', 'economic', 'aggressive'] as Personality[]) {
      const id = villageWith(state, p);
      const expected = AI.personalities[p].baseAcceptance + D.powerWeight > D.acceptThreshold;
      expect(allianceScore(state, PLAYER_ID, id)).toBeCloseTo(AI.personalities[p].baseAcceptance + D.powerWeight);
      expect(proposeAlliance(state, PLAYER_ID, id, bus)).toEqual({ ok: true, accepted: expected });
      expect(areAllied(state, PLAYER_ID, id)).toBe(expected);
      expect(areAllied(state, id, PLAYER_ID)).toBe(expected);
    }
  });

  it('a strong army convinces an aggressive village', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'aggressive');
    addUnit(state, 'knight', id, 0, 0);
    for (let i = 0; i < 3; i++) addUnit(state, 'knight', PLAYER_ID, 0, 0);
    expect(allianceScore(state, PLAYER_ID, id)).toBeCloseTo(AI.personalities.aggressive.baseAcceptance + 3 * D.powerWeight);
    expect(proposeAlliance(state, PLAYER_ID, id, bus)).toEqual({ ok: true, accepted: true });
  });

  it('a weak army makes even the economic village refuse', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'economic');
    for (let i = 0; i < 4; i++) addUnit(state, 'knight', id, 0, 0);
    expect(proposeAlliance(state, PLAYER_ID, id, bus)).toEqual({ ok: true, accepted: false });
  });

  it('the power ratio is capped', () => {
    const { state } = setup();
    const id = villageWith(state, 'aggressive');
    addUnit(state, 'archer', id, 0, 0);
    for (let i = 0; i < 20; i++) addUnit(state, 'knight', PLAYER_ID, 0, 0);
    expect(allianceScore(state, PLAYER_ID, id)).toBeCloseTo(AI.personalities.aggressive.baseAcceptance + D.maxPowerRatio * D.powerWeight);
  });

  it('a refusal lowers the relation and starts a cooldown', () => {
    const { state, bus, events } = setup();
    const id = villageWith(state, 'aggressive');
    proposeAlliance(state, PLAYER_ID, id, bus);
    expect(events).toEqual(['refused']);
    expect(relation(state, PLAYER_ID, id)).toBeCloseTo(-D.refusalPenalty);
    expect(relation(state, id, PLAYER_ID)).toBeCloseTo(-D.refusalPenalty);
    expect(checkProposeAlliance(state, PLAYER_ID, id)).toMatch(/^Attends \d+ s$/);
    state.timeMs += D.proposalCooldownMs;
    expect(checkProposeAlliance(state, PLAYER_ID, id)).toBeNull();
  });

  it('negative relations lower the score, good relations raise it', () => {
    const { state } = setup();
    const id = villageWith(state, 'economic');
    const base = allianceScore(state, PLAYER_ID, id);
    changeRelation(state, PLAYER_ID, id, -0.5);
    expect(allianceScore(state, PLAYER_ID, id)).toBeCloseTo(base - 0.5);
    changeRelation(state, id, PLAYER_ID, 0.8);
    expect(allianceScore(state, PLAYER_ID, id)).toBeCloseTo(base + 0.3);
  });
});

describe('Resources', () => {
  it('a gift leaves now, travels as a convoy and raises the relation on arrival', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'aggressive');
    const before = { ...state.villages[id].resources };
    const mine = state.villages[PLAYER_ID].resources.wood;
    expect(sendResources(state, PLAYER_ID, id, bus)).toBe(true);
    expect(state.villages[PLAYER_ID].resources.wood).toBe(mine - (D.giftPack.wood ?? 0));
    expect(state.diplomacy.convoys).toHaveLength(1);

    const system = new DiplomacySystem(bus);
    for (let i = 0; i < 2000 && state.diplomacy.convoys.length; i++) system.update(state, 100);
    expect(state.diplomacy.convoys).toHaveLength(0);
    expect(state.villages[id].resources.wood).toBe(before.wood + (D.giftPack.wood ?? 0));
    expect(relation(state, PLAYER_ID, id)).toBeCloseTo(D.giftRelation);
  });

  it('cannot send what you do not have', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'diplomat');
    state.villages[PLAYER_ID].resources.wood = 0;
    expect(sendResources(state, PLAYER_ID, id, bus)).toBe(false);
  });

  it('an ally gives only when its stock exceeds 2× its needs', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'diplomat');
    expect(requestResources(state, PLAYER_ID, id, bus)).toEqual({ ok: false, reason: 'Alliance requise' });
    proposeAlliance(state, PLAYER_ID, id, bus);

    const ally = state.villages[id];
    ally.resources.wood = 2 * (D.needs.wood ?? 0);
    ally.resources.stone = 1000;
    expect(requestResources(state, PLAYER_ID, id, bus)).toEqual({ ok: true, accepted: false });

    state.timeMs += D.requestCooldownMs;
    ally.resources.wood = 1000;
    expect(requestResources(state, PLAYER_ID, id, bus)).toEqual({ ok: true, accepted: true });
    expect(ally.resources.wood).toBe(1000 - (D.requestPack.wood ?? 0));
    expect(state.diplomacy.convoys[0]).toMatchObject({ fromId: id, toId: PLAYER_ID, gift: false });
    // Cooldown blocks spamming.
    expect(requestResources(state, PLAYER_ID, id, bus).ok).toBe(false);
  });
});

describe('Reinforcements', () => {
  it('an ally sends 30% of its army (rounded up) to the target', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'diplomat');
    proposeAlliance(state, PLAYER_ID, id, bus);
    expect(checkRequestReinforcements(state, PLAYER_ID, id)).toBe('Cet allié n’a pas d’armée');
    for (let i = 0; i < 7; i++) addUnit(state, 'archer', id, 0, 0);
    let sent: string[] = [];
    bus.on('diplomacy:reinforcements', (e) => (sent = e.unitIds));
    const ids = requestReinforcements(state, PLAYER_ID, id, { x: 5, y: 5 }, bus);
    expect(ids).toHaveLength(Math.ceil(7 * D.reinforcementShare));
    expect(sent).toEqual(ids);
  });
});

describe('Breaking alliances', () => {
  it('manual break removes both sides and hurts the relation', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'diplomat');
    proposeAlliance(state, PLAYER_ID, id, bus);
    expect(breakAlliance(state, PLAYER_ID, id, bus)).toBe(true);
    expect(areAllied(state, PLAYER_ID, id)).toBe(false);
    expect(areAllied(state, id, PLAYER_ID)).toBe(false);
    expect(relation(state, PLAYER_ID, id)).toBeCloseTo(-D.breakPenalty);
  });

  it('"Il ne peut en rester qu\'un": when only allies remain, every alliance breaks', () => {
    const { state, bus, events } = setup();
    const system = new DiplomacySystem(bus);
    const ids = Object.keys(state.villages).filter((id) => id !== PLAYER_ID);
    const [a, b] = ids;
    for (const id of [a, b]) {
      discover(state, id);
      changeRelation(state, PLAYER_ID, id, 1);
      proposeAlliance(state, PLAYER_ID, id, bus);
    }
    system.update(state, 100);
    expect(state.diplomacy.lastStanding).toBe(false);

    for (const id of ids.slice(2)) state.villages[id].alive = false;
    system.update(state, 100);
    expect(state.diplomacy.lastStanding).toBe(true);
    expect(events).toContain('lastStanding');
    expect(state.villages[PLAYER_ID].allies).toEqual([]);
    expect(checkProposeAlliance(state, PLAYER_ID, a)).toBe('Il ne peut en rester qu’un');
  });

  it('alliances with destroyed villages are dropped', () => {
    const { state, bus } = setup();
    const id = villageWith(state, 'diplomat');
    proposeAlliance(state, PLAYER_ID, id, bus);
    state.villages[id].alive = false;
    new DiplomacySystem(bus).update(state, 100);
    expect(state.villages[PLAYER_ID].allies).toEqual([]);
  });
});
