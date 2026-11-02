import { BUILDINGS, GAME, UNITS } from '../core/config';
import type { Building, GameState, TilePos, Unit, UnitType } from '../core/types';
import type { MovementSystem } from './MovementSystem';
import { tileOf } from './MovementSystem';

const UNIT_TYPES: UnitType[] = ['knight', 'archer', 'spearman'];
const SLOT_EPSILON = 0.05;

export const isArmyCamp = (b: Building): boolean => b.type === 'armyCamp' && b.buildProgress >= 1;

export function campOf(state: GameState, u: Unit): Building | undefined {
  return u.campId ? state.buildings[u.campId] : undefined;
}

/** Soldiers resting in a camp (sent-out soldiers are not counted), oldest first. */
export function soldiersInCamp(state: GameState, campId: string): Unit[] {
  return Object.values(state.units)
    .filter((u) => u.campId === campId && !u.onMission)
    .sort((a, b) => idNum(a.id) - idNum(b.id));
}

export interface CampDisplay {
  total: number;
  byType: Record<UnitType, number>;
  /** Soldiers drawn as figurines (at most `visibleSoldiers`, split by type pro rata). */
  drawn: Set<string>;
}

export function campDisplay(state: GameState, campId: string): CampDisplay {
  const resting = soldiersInCamp(state, campId);
  const byType = { knight: 0, archer: 0, spearman: 0 } as Record<UnitType, number>;
  for (const u of resting) byType[u.type]++;
  const cap = BUILDINGS.armyCamp.visibleSoldiers ?? 8;
  const quota = proRata(byType, Math.min(cap, resting.length));
  const drawn = new Set<string>();
  for (const u of resting) {
    if (quota[u.type] > 0) {
      quota[u.type]--;
      drawn.add(u.id);
    }
  }
  return { total: resting.length, byType, drawn };
}

/** Largest-remainder split of `n` figurines between unit types. */
function proRata(counts: Record<UnitType, number>, n: number): Record<UnitType, number> {
  const total = UNIT_TYPES.reduce((s, t) => s + counts[t], 0);
  const out = { knight: 0, archer: 0, spearman: 0 } as Record<UnitType, number>;
  if (total === 0 || n === 0) return out;
  const rest = UNIT_TYPES.map((t) => {
    const exact = (counts[t] * n) / total;
    out[t] = Math.floor(exact);
    return { t, frac: exact - out[t] };
  }).sort((a, b) => b.frac - a.frac);
  let left = n - UNIT_TYPES.reduce((s, t) => s + out[t], 0);
  for (const r of rest) if (left > 0 && out[r.t] < counts[r.t]) (out[r.t]++, left--);
  return out;
}

/** Ids of every soldier to draw: on mission, walking, waiting at a barracks, or a camp figurine. */
export function drawnUnitIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  const camps = new Map<string, CampDisplay>();
  for (const u of Object.values(state.units)) {
    if (u.onMission || !u.campId || u.path.length > 0 || u.targetId) {
      ids.add(u.id);
      continue;
    }
    let d = camps.get(u.campId);
    if (!d) camps.set(u.campId, (d = campDisplay(state, u.campId)));
    if (d.drawn.has(u.id) || !atRest(state, u)) ids.add(u.id);
  }
  return ids;
}

/**
 * Sends soldiers to a tile. Those resting in a camp leave one by one (column);
 * each gets its own free tile around the target. They stay there until recalled.
 */
export function sendArmy(state: GameState, movement: MovementSystem, unitIds: string[], target: TilePos): TilePos[] {
  const units = unitIds.map((id) => state.units[id]).filter((u): u is Unit => !!u);
  const spots = movement.freeTilesAround(state, target.tx, target.ty, units.length);
  const sorted = [...units].sort((a, b) => Number(!a.onMission) - Number(!b.onMission) || idNum(a.id) - idNum(b.id));
  let queued = 0;
  sorted.forEach((u, i) => {
    const spot = spots[i] ?? target;
    const leavingCamp = !u.onMission;
    u.onMission = true;
    u.missionTarget = spot;
    // A move order wins over fighting (lets the player retreat).
    u.targetId = null;
    u.ordered = false;
    u.departMs = leavingCamp ? queued++ * GAME.army.departIntervalMs : 0;
    if (u.departMs === 0) launch(state, movement, u);
  });
  return spots;
}

/** Mission over: soldiers walk back to their camp (or barracks) and are only counted again. */
export function recallArmy(state: GameState, unitIds: string[]): void {
  for (const id of unitIds) {
    const u = state.units[id];
    if (!u) continue;
    u.onMission = false;
    u.missionTarget = null;
    u.departMs = 0;
    u.path = [];
    u.targetId = null;
    u.ordered = false;
  }
}

function launch(state: GameState, movement: MovementSystem, u: Unit): void {
  const t = u.missionTarget;
  u.missionTarget = null;
  if (t) movement.moveTo(state, u, t.tx, t.ty);
}

/** Resting place: a figurine slot on the camp ground, the camp center for counted-only soldiers, or the barracks yard. */
export function restSlot(state: GameState, u: Unit): { x: number; y: number } | null {
  const camp = campOf(state, u);
  if (camp) {
    const d = campDisplay(state, camp.id);
    const size = BUILDINGS.armyCamp.size;
    const figurines = soldiersInCamp(state, camp.id).filter((s) => d.drawn.has(s.id));
    const i = figurines.findIndex((s) => s.id === u.id);
    if (i < 0) return { x: camp.tx + size / 2 - 0.5, y: camp.ty + size / 2 - 0.5 };
    return compactSlot(camp.tx + size / 2 - 0.5, camp.ty + size / 2 - 0.5, i, figurines.length, 0.8);
  }
  const barracks = Object.values(state.buildings).find(
    (b) => b.ownerId === u.ownerId && b.buildProgress >= 1 && BUILDINGS[b.type].converts?.includes(u.type),
  );
  if (!barracks) return null;
  const waiting = Object.values(state.units)
    .filter((w) => w.ownerId === u.ownerId && !w.onMission && !w.campId)
    .sort((a, b) => idNum(a.id) - idNum(b.id));
  const i = Math.max(0, waiting.findIndex((w) => w.id === u.id));
  const size = BUILDINGS[barracks.type].size;
  const cols = Math.max(1, Math.ceil(Math.sqrt(waiting.length)));
  const rows = Math.ceil(waiting.length / cols);
  // Square block centered under the barracks, first row just below its front.
  return compactSlot(barracks.tx + size / 2 - 0.5, barracks.ty + size + 0.2 + ((rows - 1) * 0.7) / 2, i, waiting.length, 0.7);
}

/** Slot `i` of a square grid of `n` slots (≈√n columns) centered on (cx, cy). */
export function compactSlot(cx: number, cy: number, i: number, n: number, spacing: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: cx + (col - (cols - 1) / 2) * spacing, y: cy + (row - (rows - 1) / 2) * spacing };
}

function atRest(state: GameState, u: Unit): boolean {
  const slot = restSlot(state, u);
  return !slot || Math.hypot(slot.x - u.x, slot.y - u.y) <= SLOT_EPSILON;
}

const idNum = (id: string): number => Number(id.split('-')[1]) || 0;

/**
 * Army camps: every resting soldier belongs to the least-filled completed camp of its
 * village (or waits in a compact block in front of the barracks without one) and walks
 * to its slot. Sent-out soldiers leave in a column (departMs) and stay where they were sent.
 */
export class ArmySystem {
  constructor(private movement: MovementSystem) {}

  update(state: GameState, dtMs: number): void {
    this.assignCamps(state);
    for (const u of Object.values(state.units)) {
      if (u.onMission) {
        if (u.departMs > 0) {
          u.departMs -= dtMs;
          if (u.departMs <= 0) launch(state, this.movement, u);
        }
        continue;
      }
      // Walking, or fighting (CombatSystem drives defenders until the threat is gone).
      if (u.path.length > 0 || u.targetId) continue;
      const slot = restSlot(state, u);
      if (!slot) continue;
      const t = tileOf(slot);
      const here = tileOf(u);
      if (Math.abs(t.tx - here.tx) > 1 || Math.abs(t.ty - here.ty) > 1) {
        this.movement.moveTo(state, u, t.tx, t.ty);
        continue;
      }
      // Last steps inside the camp / yard: straight to the exact slot.
      const dx = slot.x - u.x;
      const dy = slot.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d <= SLOT_EPSILON) continue;
      const step = Math.min(d, UNITS[u.type].speed * (dtMs / 1000));
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
    }
  }

  private assignCamps(state: GameState): void {
    const load = new Map<string, number>();
    const campsByVillage = new Map<string, Building[]>();
    for (const b of Object.values(state.buildings)) {
      if (!isArmyCamp(b)) continue;
      load.set(b.id, 0);
      const list = campsByVillage.get(b.ownerId) ?? [];
      list.push(b);
      campsByVillage.set(b.ownerId, list);
    }
    const units = Object.values(state.units).sort((a, b) => idNum(a.id) - idNum(b.id));
    for (const u of units) {
      const camp = u.campId ? state.buildings[u.campId] : undefined;
      if (camp && isArmyCamp(camp) && camp.ownerId === u.ownerId) load.set(camp.id, load.get(camp.id)! + 1);
      else u.campId = null;
    }
    for (const u of units) {
      if (u.campId) continue;
      const camps = campsByVillage.get(u.ownerId);
      if (!camps) continue;
      const best = camps.reduce((a, b) => (load.get(b.id)! < load.get(a.id)! ? b : a));
      u.campId = best.id;
      load.set(best.id, load.get(best.id)! + 1);
    }
  }
}
