import { refundTraining } from './TrainingSystem';
import { BUILDINGS, COUNTER_MULTIPLIER, GAME, UNITS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { Building, GameState, Mover, Unit, Villager } from '../core/types';
import type { MovementSystem } from './MovementSystem';
import { tileOf } from './MovementSystem';
import { killVillager } from './VillagerSystem';

export type Target =
  | { kind: 'unit'; e: Unit; ownerId: string }
  | { kind: 'villager'; e: Villager; ownerId: string }
  | { kind: 'building'; e: Building; ownerId: string };

const idNum = (id: string): number => Number(id.split('-')[1]) || 0;

/** Different villages that are not allied (alliances are checked both ways). */
export function isEnemy(state: GameState, a: string, b: string): boolean {
  return a !== b && !state.villages[a]?.allies.includes(b) && !state.villages[b]?.allies.includes(a);
}

/** Unit, visible villager or building with this id (null if gone). */
export function resolveTarget(state: GameState, id: string): Target | null {
  const u = state.units[id];
  if (u) return { kind: 'unit', e: u, ownerId: u.ownerId };
  const v = state.villagers[id];
  if (v) return v.inside ? null : { kind: 'villager', e: v, ownerId: v.ownerId };
  const b = state.buildings[id];
  return b ? { kind: 'building', e: b, ownerId: b.ownerId } : null;
}

/** Distance from a point to a target: center for movers, nearest footprint edge for buildings. */
export function distanceTo(x: number, y: number, t: Target): number {
  if (t.kind !== 'building') return Math.hypot(t.e.x - x, t.e.y - y);
  const size = BUILDINGS[t.e.type].size;
  const dx = Math.max(t.e.tx - 0.5 - x, 0, x - (t.e.tx + size - 0.5));
  const dy = Math.max(t.e.ty - 0.5 - y, 0, y - (t.e.ty + size - 0.5));
  return Math.hypot(dx, dy);
}

/** Center of a building in mover coordinates. */
export function buildingCenter(b: Building): { x: number; y: number } {
  const size = BUILDINGS[b.type].size;
  return { x: b.tx + size / 2 - 0.5, y: b.ty + size / 2 - 0.5 };
}

export function inRange(u: Unit, t: Target): boolean {
  return distanceTo(u.x, u.y, t) <= UNITS[u.type].range + GAME.combat.reach;
}

/** Damage of one hit: counter ×1.5 (`strongAgainst`), building multiplier (knight ×1.5). */
export function hitDamage(u: Unit, t: Target): number {
  const def = UNITS[u.type];
  let dmg = def.attack;
  if (t.kind === 'unit' && def.strongAgainst?.includes(t.e.type)) dmg *= COUNTER_MULTIPLIER;
  if (t.kind === 'building') dmg *= def.buildingDamageMultiplier ?? 1;
  return dmg;
}

/**
 * Nearest enemy of `ownerId` within `radius` of (x, y), by priority: warriors, then
 * visible villagers, then buildings (towers skip buildings). Ties go to the oldest id.
 */
export function findEnemy(
  state: GameState,
  ownerId: string,
  x: number,
  y: number,
  radius: number,
  withBuildings = true,
): Target | null {
  const nearest = <T extends Mover>(list: T[]): T | null => {
    let best: T | null = null;
    let bestD = radius;
    for (const m of list) {
      if (!isEnemy(state, ownerId, m.ownerId)) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD || (d === bestD && best && idNum(m.id) < idNum(best.id))) (bestD = d, (best = m));
    }
    return best;
  };
  const u = nearest(Object.values(state.units));
  if (u) return { kind: 'unit', e: u, ownerId: u.ownerId };
  const v = nearest(Object.values(state.villagers).filter((w) => !w.inside));
  if (v) return { kind: 'villager', e: v, ownerId: v.ownerId };
  if (!withBuildings) return null;
  let best: Building | null = null;
  let bestD = radius;
  for (const b of Object.values(state.buildings)) {
    if (!isEnemy(state, ownerId, b.ownerId)) continue;
    const d = distanceTo(x, y, { kind: 'building', e: b, ownerId: b.ownerId });
    if (d < bestD) (bestD = d, (best = b));
  }
  return best ? { kind: 'building', e: best, ownerId: best.ownerId } : null;
}

/**
 * Attack order (player tap / AI): the soldiers chase this target until it is destroyed.
 * Soldiers resting in a camp leave one by one, like `sendArmy`. Returns how many obey.
 */
export function orderAttack(state: GameState, unitIds: string[], targetId: string): number {
  const t = resolveTarget(state, targetId);
  if (!t) return 0;
  let queued = 0;
  let count = 0;
  for (const id of unitIds) {
    const u = state.units[id];
    if (!u || !isEnemy(state, u.ownerId, t.ownerId)) continue;
    const leavingCamp = !u.onMission;
    u.onMission = true;
    u.missionTarget = null;
    u.departMs = leavingCamp ? queued++ * GAME.army.departIntervalMs : 0;
    u.targetId = targetId;
    u.ordered = true;
    u.repathAtMs = 0;
    count++;
  }
  return count;
}

/**
 * Automatic combat (GDD §6). Warriors standing still pick the nearest enemy in their
 * aggroRange, walk into range (MovementSystem) and hit every attackCooldownMs. Walking
 * warriors obey their move order. Resting warriors of an attacked village defend.
 * Towers shoot. Kills, building destruction, eliminated villages and the game outcome.
 * Run after ArmySystem (which leaves fighting soldiers alone) and before MovementSystem.
 */
export class CombatSystem {
  constructor(
    private movement: MovementSystem,
    private bus: EventBus,
  ) {}

  update(state: GameState, _dtMs: number): void {
    if (state.status !== 'playing') return;
    const units = Object.values(state.units).sort((a, b) => idNum(a.id) - idNum(b.id));
    for (const u of units) {
      if (state.units[u.id]) this.updateUnit(state, u);
    }
    for (const b of Object.values(state.buildings)) {
      if (state.buildings[b.id]) this.updateTower(state, b);
    }
  }

  private updateUnit(state: GameState, u: Unit): void {
    if (u.departMs > 0) return; // still waiting for its turn to leave the camp
    const def = UNITS[u.type];
    let t = u.targetId ? resolveTarget(state, u.targetId) : null;
    if (t && !isEnemy(state, u.ownerId, t.ownerId)) t = null;
    // Automatic targets are dropped once they run too far (ordered ones are chased anywhere).
    if (t && !u.ordered && distanceTo(u.x, u.y, t) > Math.max(def.aggroRange, GAME.combat.defendRadius)) t = null;
    if (!t && u.targetId) this.stopFighting(u);
    // An automatic target that is not a warrior gives way to an enemy warrior coming close.
    if (t && !u.ordered && t.kind !== 'unit') {
      const warrior = findEnemy(state, u.ownerId, u.x, u.y, def.aggroRange, false);
      if (warrior?.kind === 'unit') {
        t = warrior;
        u.targetId = warrior.e.id;
        u.repathAtMs = 0;
      }
    }

    if (!t && u.path.length === 0) {
      t = findEnemy(state, u.ownerId, u.x, u.y, def.aggroRange);
      if (!t && !u.onMission) t = this.defendTarget(state, u);
      if (t) {
        u.targetId = t.e.id;
        u.ordered = false;
        u.repathAtMs = 0;
      }
    }
    if (!t) return;

    if (inRange(u, t)) {
      u.path = [];
      if (state.timeMs >= u.nextAttackMs) {
        u.nextAttackMs = state.timeMs + def.attackCooldownMs;
        u.lastAttackMs = state.timeMs;
        this.damage(state, t, hitDamage(u, t), u.ownerId);
      }
      return;
    }
    if (u.path.length === 0 || state.timeMs >= u.repathAtMs) {
      u.repathAtMs = state.timeMs + GAME.combat.repathMs;
      if (t.kind === 'building') this.movement.moveNextTo(state, u, t.e);
      else {
        const goal = tileOf(t.e);
        this.movement.moveTo(state, u, goal.tx, goal.ty);
      }
    }
  }

  /** Resting warrior of a village that was just attacked nearby: goes for the closest enemy. */
  private defendTarget(state: GameState, u: Unit): Target | null {
    const alarm = state.villages[u.ownerId]?.alarm;
    if (!alarm || state.timeMs > alarm.untilMs) return null;
    const r = GAME.combat.defendRadius;
    if (Math.hypot(alarm.x - u.x, alarm.y - u.y) > r) return null;
    return findEnemy(state, u.ownerId, u.x, u.y, r, false);
  }

  private stopFighting(u: Unit): void {
    u.targetId = null;
    u.ordered = false;
    if (!u.onMission) u.path = []; // ArmySystem walks it back to its camp slot
  }

  private updateTower(state: GameState, b: Building): void {
    const def = BUILDINGS[b.type];
    if (!def.attack || !def.attackRange || b.buildProgress < 1) return;
    const c = buildingCenter(b);
    let t = b.targetId ? resolveTarget(state, b.targetId) : null;
    if (t && (t.kind === 'building' || !isEnemy(state, b.ownerId, t.ownerId) || distanceTo(c.x, c.y, t) > def.attackRange)) t = null;
    t ??= findEnemy(state, b.ownerId, c.x, c.y, def.attackRange, false);
    b.targetId = t?.e.id ?? null;
    if (!t || state.timeMs < (b.nextAttackMs ?? 0)) return;
    b.nextAttackMs = state.timeMs + (def.attackCooldownMs ?? 1000);
    b.lastAttackMs = state.timeMs;
    this.damage(state, t, def.attack, b.ownerId);
  }

  private damage(state: GameState, t: Target, amount: number, attackerOwner: string): void {
    t.e.hp -= amount;
    // Alarm where the victim stands: resting warriors around come out to defend.
    const victim = state.villages[t.ownerId];
    const at = t.kind === 'building' ? buildingCenter(t.e) : t.e;
    if (victim) victim.alarm = { x: at.x, y: at.y, untilMs: state.timeMs + GAME.combat.alarmMs };
    if (t.e.hp > 0) return;
    if (t.kind === 'unit') {
      delete state.units[t.e.id];
      this.bus.emit('unit:killed', { id: t.e.id, ownerId: t.ownerId, kind: 'unit', killerOwnerId: attackerOwner });
    } else if (t.kind === 'villager') {
      killVillager(state, t.e.id);
      this.bus.emit('unit:killed', { id: t.e.id, ownerId: t.ownerId, kind: 'villager', killerOwnerId: attackerOwner });
    } else this.destroyBuilding(state, t.e);
  }

  private destroyBuilding(state: GameState, b: Building): void {
    refundTraining(state, b.id);
    delete state.buildings[b.id];
    this.bus.emit('building:destroyed', { buildingId: b.id });
    if (b.type !== 'townHall') return;
    const village = state.villages[b.ownerId];
    if (village?.alive) {
      village.alive = false;
      this.bus.emit('village:destroyed', { villageId: village.id });
      if (village.isPlayer) this.bus.emit('notify', { message: 'Ton hôtel de ville est tombé !' });
      else this.bus.emit('notify', { message: `${village.name} est détruit !` });
    }
    checkGameOver(state, this.bus);
  }
}

/** GDD §10: lost when the player's town hall falls, won when no non-allied rival is left. */
export function checkGameOver(state: GameState, bus: EventBus): void {
  if (state.status !== 'playing') return;
  const player = state.villages[PLAYER_ID];
  if (!player) return;
  let status: 'won' | 'lost' | null = null;
  if (!player.alive) status = 'lost';
  else if (!Object.values(state.villages).some((v) => v.alive && v.id !== PLAYER_ID && isEnemy(state, PLAYER_ID, v.id))) status = 'won';
  if (!status) return;
  state.status = status;
  bus.emit('game:over', { status });
}
