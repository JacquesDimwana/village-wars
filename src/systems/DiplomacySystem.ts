import { AI, BUILDINGS, PROGRESSION, UNITS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import { nextId, townHallOf } from '../core/GameState';
import type { Cost, GameState, ResourceType } from '../core/types';
import { addResources, canAfford, spend } from './EconomySystem';
import { isExplored } from './FogSystem';

const D = AI.diplomacy;
const RESOURCE_TYPES: ResourceType[] = ['food', 'wood', 'stone', 'iron'];

/** Result of a diplomatic action: impossible (with the reason shown to the player) or answered. */
export type DiplomacyResult = { ok: false; reason: string } | { ok: true; accepted: boolean };

type CooldownAction = 'alliance' | 'request' | 'reinforce';

/** Army power = sum of (HP × attack) of the village's military units. */
export function armyPower(state: GameState, villageId: string): number {
  let power = 0;
  for (const u of Object.values(state.units)) {
    const def = UNITS[u.type];
    if (u.ownerId === villageId && def.military) {
      const bonus = state.villages[villageId].upgrades.reduce((n, key) => n + (PROGRESSION.upgrades[key].units.includes(u.type) ? PROGRESSION.upgrades[key].attack : 0), 0);
      power += u.hp * (def.attack + bonus);
    }
  }
  return power;
}

/** Relation between two villages, -1..1 (symmetric). */
export function relation(state: GameState, a: string, b: string): number {
  return state.villages[a]?.relations[b] ?? 0;
}

export function changeRelation(state: GameState, a: string, b: string, delta: number): void {
  const next = Math.max(-1, Math.min(1, relation(state, a, b) + delta));
  state.villages[a].relations[b] = next;
  state.villages[b].relations[a] = next;
}

export function areAllied(state: GameState, a: string, b: string): boolean {
  return state.villages[a]?.allies.includes(b) ?? false;
}

/** A village is known once the player has explored its town hall. */
export function isVillageKnown(state: GameState, villageId: string): boolean {
  const hall = townHallOf(state, villageId);
  return !!hall && isExplored(state.fog, hall.tx, hall.ty);
}

function hallCenter(state: GameState, villageId: string): { x: number; y: number } | undefined {
  const hall = townHallOf(state, villageId);
  const c = BUILDINGS.townHall.size / 2;
  return hall && { x: hall.tx + c, y: hall.ty + c };
}

/** §9: baseAcceptance + min(power ratio, max) × weight + relation. Accepted above acceptThreshold. */
export function allianceScore(state: GameState, fromId: string, toId: string): number {
  const target = state.villages[toId];
  const base = target.personality ? AI.personalities[target.personality].baseAcceptance : 0;
  const mine = armyPower(state, fromId);
  const theirs = armyPower(state, toId);
  const ratio = theirs > 0 ? mine / theirs : mine > 0 ? Infinity : 1;
  return base + ratio * D.powerWeight + Math.min(0, relation(state, fromId, toId));
}

const cooldownKey = (action: CooldownAction, fromId: string, toId: string): string => `${action}:${fromId}>${toId}`;

/** Milliseconds before `action` can be done again from → to. */
export function cooldownLeft(state: GameState, action: CooldownAction, fromId: string, toId: string): number {
  return Math.max(0, (state.diplomacy.cooldowns[cooldownKey(action, fromId, toId)] ?? 0) - state.timeMs);
}

function startCooldown(state: GameState, action: CooldownAction, fromId: string, toId: string, ms: number): void {
  state.diplomacy.cooldowns[cooldownKey(action, fromId, toId)] = state.timeMs + ms;
}

const waitReason = (ms: number): string => `Attends ${Math.ceil(ms / 1000)} s`;

/** Common checks for every action. The player can only deal with villages they discovered. */
function checkTarget(state: GameState, fromId: string, toId: string): string | null {
  const from = state.villages[fromId];
  const to = state.villages[toId];
  if (!from || !to || fromId === toId) return 'Village invalide';
  if (!to.alive) return 'Ce village est détruit';
  if (!from.alive) return 'Ton village est détruit';
  if (fromId === PLAYER_ID && !isVillageKnown(state, toId)) return 'Village pas encore découvert';
  return null;
}

export function checkProposeAlliance(state: GameState, fromId: string, toId: string): string | null {
  const err = checkTarget(state, fromId, toId);
  if (err) return err;
  if (state.diplomacy.lastStanding) return 'Il ne peut en rester qu’un';
  if (areAllied(state, fromId, toId)) return 'Déjà allié';
  const wait = cooldownLeft(state, 'alliance', fromId, toId);
  return wait > 0 ? waitReason(wait) : null;
}

export function proposeAlliance(state: GameState, fromId: string, toId: string, bus: EventBus): DiplomacyResult {
  const reason = checkProposeAlliance(state, fromId, toId);
  if (reason) return { ok: false, reason };
  const score = allianceScore(state, fromId, toId);
  const accepted = score > D.acceptThreshold;
  if (accepted) {
    state.villages[fromId].allies.push(toId);
    state.villages[toId].allies.push(fromId);
    for (const unit of Object.values(state.units)) {
      const target = unit.targetId && (state.units[unit.targetId] ?? state.villagers[unit.targetId] ?? state.buildings[unit.targetId]);
      if (target && ((unit.ownerId === fromId && target.ownerId === toId) || (unit.ownerId === toId && target.ownerId === fromId))) {
        unit.targetId = null; unit.ordered = false; unit.path = [];
      }
    }
    for (const building of Object.values(state.buildings)) {
      const target = building.targetId && (state.units[building.targetId] ?? state.villagers[building.targetId]);
      if (target && ((building.ownerId === fromId && target.ownerId === toId) || (building.ownerId === toId && target.ownerId === fromId))) building.targetId = null;
    }
  } else {
    changeRelation(state, fromId, toId, -D.refusalPenalty);
    startCooldown(state, 'alliance', fromId, toId, D.proposalCooldownMs);
  }
  bus.emit('diplomacy:alliance', { fromId, toId, accepted, score });
  return { ok: true, accepted };
}

export function checkBreakAlliance(state: GameState, fromId: string, toId: string): string | null {
  return areAllied(state, fromId, toId) ? null : 'Pas d’alliance';
}

export function breakAlliance(
  state: GameState,
  fromId: string,
  toId: string,
  bus: EventBus,
  reason: 'manual' | 'lastStanding' = 'manual',
): boolean {
  if (checkBreakAlliance(state, fromId, toId)) return false;
  const a = state.villages[fromId];
  const b = state.villages[toId];
  a.allies = a.allies.filter((id) => id !== toId);
  b.allies = b.allies.filter((id) => id !== fromId);
  if (reason === 'manual') changeRelation(state, fromId, toId, -D.breakPenalty);
  bus.emit('diplomacy:allianceBroken', { byId: fromId, otherId: toId, reason });
  return true;
}

function startConvoy(state: GameState, fromId: string, toId: string, resources: Cost, gift: boolean, bus: EventBus): void {
  const start = hallCenter(state, fromId);
  const dest = hallCenter(state, toId);
  if (!start || !dest) return;
  const convoy = { id: nextId(state, 'c'), fromId, toId, resources, x: start.x, y: start.y, destX: dest.x, destY: dest.y, gift };
  state.diplomacy.convoys.push(convoy);
  bus.emit('diplomacy:convoySent', { convoyId: convoy.id, fromId, toId, resources });
}

export function checkSendResources(state: GameState, fromId: string, toId: string, pack: Cost = D.giftPack): string | null {
  const err = checkTarget(state, fromId, toId);
  if (err) return err;
  if (!townHallOf(state, toId)) return 'Ce village n’a plus d’hôtel de ville';
  return canAfford(state.villages[fromId], pack) ? null : 'Pas assez de ressources';
}

/** Gift: resources leave now and travel in a convoy; relation rises on arrival. */
export function sendResources(state: GameState, fromId: string, toId: string, bus: EventBus, pack: Cost = D.giftPack): boolean {
  if (checkSendResources(state, fromId, toId, pack)) return false;
  spend(state.villages[fromId], pack);
  startConvoy(state, fromId, toId, { ...pack }, true, bus);
  return true;
}

/** An ally gives only if, for each resource, its stock exceeds 2× its needs and it keeps its needs. */
export function canSpare(state: GameState, villageId: string, pack: Cost): boolean {
  const stock = state.villages[villageId].resources;
  return RESOURCE_TYPES.every((r) => {
    const amount = pack[r] ?? 0;
    const needs = D.needs[r] ?? 0;
    return amount === 0 || (stock[r] > 2 * needs && stock[r] - amount >= needs);
  });
}

export function checkRequestResources(state: GameState, fromId: string, toId: string): string | null {
  const err = checkTarget(state, fromId, toId);
  if (err) return err;
  if (!areAllied(state, fromId, toId)) return 'Alliance requise';
  const wait = cooldownLeft(state, 'request', fromId, toId);
  return wait > 0 ? waitReason(wait) : null;
}

/** Asks an ally for `pack`. If it can spare it, the ally sends a convoy back. */
export function requestResources(
  state: GameState,
  fromId: string,
  toId: string,
  bus: EventBus,
  pack: Cost = D.requestPack,
): DiplomacyResult {
  const reason = checkRequestResources(state, fromId, toId);
  if (reason) return { ok: false, reason };
  startCooldown(state, 'request', fromId, toId, D.requestCooldownMs);
  const accepted = canSpare(state, toId, pack);
  if (accepted) {
    spend(state.villages[toId], pack);
    changeRelation(state, fromId, toId, -D.requestRelationCost);
    startConvoy(state, toId, fromId, { ...pack }, false, bus);
  }
  bus.emit('diplomacy:resourcesRequested', { fromId, toId, accepted });
  return { ok: true, accepted };
}

export function checkRequestReinforcements(state: GameState, fromId: string, toId: string): string | null {
  const err = checkTarget(state, fromId, toId);
  if (err) return err;
  if (!areAllied(state, fromId, toId)) return 'Alliance requise';
  if (!Object.values(state.units).some((u) => u.ownerId === toId && UNITS[u.type].military)) return 'Cet allié n’a pas d’armée';
  const wait = cooldownLeft(state, 'reinforce', fromId, toId);
  return wait > 0 ? waitReason(wait) : null;
}

/**
 * The ally sends `reinforcementShare` of its army (rounded up) towards `target`.
 * Returns the chosen unit ids; moving them is up to the movement / AI systems,
 * which listen to 'diplomacy:reinforcements'.
 */
export function requestReinforcements(
  state: GameState,
  fromId: string,
  toId: string,
  target: { x: number; y: number },
  bus: EventBus,
): string[] {
  if (checkRequestReinforcements(state, fromId, toId)) return [];
  const army = Object.values(state.units).filter((u) => u.ownerId === toId && UNITS[u.type].military);
  const unitIds = army.slice(0, Math.ceil(army.length * D.reinforcementShare)).map((u) => u.id);
  startCooldown(state, 'reinforce', fromId, toId, D.requestCooldownMs);
  bus.emit('diplomacy:reinforcements', { allyId: toId, requesterId: fromId, unitIds, target });
  return unitIds;
}

/**
 * Moves convoys, drops alliances with dead villages and applies
 * "Il ne peut en rester qu'un": when only the player's allies are left, every alliance breaks.
 */
export class DiplomacySystem {
  constructor(private bus: EventBus) {}

  update(state: GameState, dtMs: number): void {
    this.moveConvoys(state, dtMs);
    for (const v of Object.values(state.villages)) {
      v.allies = v.allies.filter((id) => state.villages[id]?.alive);
    }
    this.checkLastStanding(state);
  }

  private moveConvoys(state: GameState, dtMs: number): void {
    const step = D.convoySpeed * (dtMs / 1000);
    state.diplomacy.convoys = state.diplomacy.convoys.filter((c) => {
      const dest = state.villages[c.toId];
      if (!dest?.alive) return false;
      const dx = c.destX - c.x;
      const dy = c.destY - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > step) {
        c.x += (dx / dist) * step;
        c.y += (dy / dist) * step;
        return true;
      }
      addResources(dest, c.resources);
      if (c.gift) changeRelation(state, c.fromId, c.toId, D.giftRelation);
      this.bus.emit('diplomacy:convoyArrived', { convoyId: c.id, fromId: c.fromId, toId: c.toId, resources: c.resources });
      this.bus.emit('resources:changed', { villageId: c.toId, resources: dest.resources });
      return false;
    });
  }

  private checkLastStanding(state: GameState): void {
    const player = state.villages[PLAYER_ID];
    if (state.diplomacy.lastStanding || !player?.alive) return;
    const others = Object.values(state.villages).filter((v) => !v.isPlayer && v.alive);
    if (others.length === 0 || !others.every((v) => player.allies.includes(v.id))) return;
    state.diplomacy.lastStanding = true;
    const alive = [player, ...others];
    for (const a of alive) for (const b of alive) if (a.id < b.id) breakAlliance(state, a.id, b.id, this.bus, 'lastStanding');
    this.bus.emit('diplomacy:lastStanding', {});
  }
}
