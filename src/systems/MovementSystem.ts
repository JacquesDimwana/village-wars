import { BUILDINGS, GAME, UNITS, VILLAGER } from '../core/config';
import type { Building, GameState, Mover, TilePos, TileType, Unit } from '../core/types';
import { isWalkable } from '../world/WorldGen';

export type TileQuery = (tx: number, ty: number) => TileType;

const SQRT2 = Math.SQRT2;
const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Numeric tile key (coordinates stay well inside ±32768). */
export const tileKey = (tx: number, ty: number): number => (tx + 0x8000) * 0x10000 + (ty + 0x8000);
const keyX = (k: number): number => Math.floor(k / 0x10000) - 0x8000;
const keyY = (k: number): number => (k % 0x10000) - 0x8000;

/** Tile a mover stands on (mover x/y = tile coordinates of its center). */
export const tileOf = (m: { x: number; y: number }): TilePos => ({ tx: Math.floor(m.x + 0.5), ty: Math.floor(m.y + 0.5) });

const octile = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
};

/**
 * A* on the tile grid, 8 directions, no corner cutting, bounded to `maxNodes` expansions
 * (the map is infinite). Returns the tiles to walk through (start excluded, goal included).
 * If no goal is reachable within the budget, returns a path to the explored tile closest
 * to `hint`, so a tap on water still brings units to the shore.
 */
export function findPath(
  walkable: (tx: number, ty: number) => boolean,
  start: TilePos,
  isGoal: (tx: number, ty: number) => boolean,
  hint: TilePos,
  maxNodes: number = GAME.pathfinding.maxNodes,
): TilePos[] {
  const startKey = tileKey(start.tx, start.ty);
  if (isGoal(start.tx, start.ty)) return [];
  const g = new Map<number, number>([[startKey, 0]]);
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new MinHeap();
  heap.push(startKey, octile(start.tx, start.ty, hint.tx, hint.ty));
  let best = startKey;
  let bestH = Infinity;
  let expanded = 0;

  while (heap.size > 0 && expanded < maxNodes) {
    const k = heap.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    expanded++;
    const x = keyX(k);
    const y = keyY(k);
    if (k !== startKey && isGoal(x, y)) return unwind(parent, k);
    const h = octile(x, y, hint.tx, hint.ty);
    if (h < bestH) {
      bestH = h;
      best = k;
    }
    const gk = g.get(k)!;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(nx, ny)) continue;
      // Diagonal moves need both side tiles free (no squeezing between two buildings).
      if (dx !== 0 && dy !== 0 && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
      const nk = tileKey(nx, ny);
      if (closed.has(nk)) continue;
      const ng = gk + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (ng >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, ng);
      parent.set(nk, k);
      heap.push(nk, ng + octile(nx, ny, hint.tx, hint.ty));
    }
  }
  return best === startKey ? [] : unwind(parent, best);
}

function unwind(parent: Map<number, number>, end: number): TilePos[] {
  const path: TilePos[] = [];
  for (let k: number | undefined = end; k !== undefined && parent.has(k); k = parent.get(k)) {
    path.push({ tx: keyX(k), ty: keyY(k) });
  }
  return path.reverse();
}

class MinHeap {
  private keys: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, p: number): void {
    const { keys, prio } = this;
    let i = keys.length;
    keys.push(key);
    prio.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (prio[up] <= p) break;
      keys[i] = keys[up];
      prio[i] = prio[up];
      i = up;
    }
    keys[i] = key;
    prio[i] = p;
  }

  pop(): number {
    const { keys, prio } = this;
    const top = keys[0];
    const lastK = keys.pop()!;
    const lastP = prio.pop()!;
    if (keys.length > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= keys.length) break;
        const c = l + 1 < keys.length && prio[l + 1] < prio[l] ? l + 1 : l;
        if (prio[c] >= lastP) break;
        keys[i] = keys[c];
        prio[i] = prio[c];
        i = c;
      }
      keys[i] = lastK;
      prio[i] = lastP;
    }
    return top;
  }
}

const isUnit = (m: Mover): m is Unit => 'type' in m;
const speedOf = (m: Mover): number => (isUnit(m) ? UNITS[m.type].speed : VILLAGER.speed);

/**
 * Grid movement shared by warriors and villagers: water and buildings block, paths come
 * from A*, and movers that overlap push each other apart so they don't stack.
 * Other systems ask it for paths (moveTo / moveNextTo / moveGroup).
 */
export class MovementSystem {
  private tileCache = new Map<number, TileType>();
  private blocked = new Set<number>();
  private blockedSignature = '';
  private knownBuildings: string[] = [];

  constructor(private getTile: TileQuery) {}

  /** Terrain type (cached: the world never changes and noise is not free). */
  tile(tx: number, ty: number): TileType {
    const k = tileKey(tx, ty);
    let t = this.tileCache.get(k);
    if (t === undefined) {
      t = this.getTile(tx, ty);
      this.tileCache.set(k, t);
    }
    return t;
  }

  /** Water blocks. */
  terrainWalkable(tx: number, ty: number): boolean {
    return isWalkable(this.tile(tx, ty));
  }

  /** Terrain walkable and no building footprint (buildings under construction block too). */
  walkable(state: GameState, tx: number, ty: number): boolean {
    this.refreshBlocked(state);
    return !this.blocked.has(tileKey(tx, ty)) && this.terrainWalkable(tx, ty);
  }

  /** Sets a path to (tx, ty) (or as close as possible). Returns false if already there. */
  moveTo(state: GameState, m: Mover, tx: number, ty: number): boolean {
    m.path = this.path(state, m, (x, y) => x === tx && y === ty, { tx, ty });
    return m.path.length > 0;
  }

  /** Path to any free tile touching the building (its "door"). */
  moveNextTo(state: GameState, m: Mover, b: Building): boolean {
    const size = BUILDINGS[b.type].size;
    const hint = { tx: b.tx + Math.floor(size / 2), ty: b.ty + size };
    m.path = this.path(state, m, (x, y) => touches(b, size, x, y), hint);
    return m.path.length > 0;
  }

  /** True when the mover stands on a tile touching the building. */
  isNextTo(m: Mover, b: Building): boolean {
    const t = tileOf(m);
    return touches(b, BUILDINGS[b.type].size, t.tx, t.ty);
  }

  /**
   * Group order: every mover gets its own free tile around (tx, ty), closest movers
   * to the target take the closest tiles. Returns the destination tiles (for markers).
   */
  moveGroup(state: GameState, movers: Mover[], tx: number, ty: number): TilePos[] {
    const spots = this.freeTilesAround(state, tx, ty, movers.length);
    const sorted = [...movers].sort((a, b) => octile(a.x, a.y, tx, ty) - octile(b.x, b.y, tx, ty));
    sorted.forEach((m, i) => {
      const spot = spots[i] ?? { tx, ty };
      this.moveTo(state, m, spot.tx, spot.ty);
    });
    return spots;
  }

  /** Up to `count` walkable tiles in rings around (tx, ty), nearest first. */
  freeTilesAround(state: GameState, tx: number, ty: number, count: number, maxRadius = 6): TilePos[] {
    const out: TilePos[] = [];
    for (let r = 0; r <= maxRadius && out.length < count; r++) {
      const ring: TilePos[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.walkable(state, tx + dx, ty + dy)) ring.push({ tx: tx + dx, ty: ty + dy });
        }
      }
      ring.sort((a, b) => Math.hypot(a.tx - tx, a.ty - ty) - Math.hypot(b.tx - tx, b.ty - ty));
      out.push(...ring.slice(0, count - out.length));
    }
    return out;
  }

  update(state: GameState, dtMs: number): void {
    this.refreshBlocked(state);
    const dt = dtMs / 1000;
    const movers: Mover[] = [...Object.values(state.units), ...Object.values(state.villagers)];
    for (const m of movers) this.step(state, m, speedOf(m) * dt);
    this.separate(state, movers);
  }

  /**
   * A building was placed on top of movers: each one inside its footprint steps to the
   * nearest free tile. Called automatically when buildings change; exported for construction.
   */
  evictFrom(state: GameState, b: Building): number {
    if (b.type === 'armyCamp') return 0;
    const size = BUILDINGS[b.type].size;
    let moved = 0;
    for (const m of [...Object.values(state.units), ...Object.values(state.villagers)]) {
      const t = tileOf(m);
      if (t.tx < b.tx || t.tx >= b.tx + size || t.ty < b.ty || t.ty >= b.ty + size) continue;
      const spot = this.freeTilesAround(state, t.tx, t.ty, 1, size + 2)[0];
      if (!spot) continue;
      m.x = spot.tx;
      m.y = spot.ty;
      m.path = [];
      moved++;
    }
    return moved;
  }

  private step(state: GameState, m: Mover, dist: number): void {
    let left = dist;
    while (left > 0 && m.path.length > 0) {
      const next = m.path[0];
      if (!this.walkable(state, next.tx, next.ty)) {
        // Something was built on the way: re-plan towards the same destination.
        const dest = m.path[m.path.length - 1];
        this.moveTo(state, m, dest.tx, dest.ty);
        return;
      }
      const dx = next.tx - m.x;
      const dy = next.ty - m.y;
      const d = Math.hypot(dx, dy);
      if (d <= left) {
        m.x = next.tx;
        m.y = next.ty;
        m.path.shift();
        left -= d;
      } else {
        m.x += (dx / d) * left;
        m.y += (dy / d) * left;
        left = 0;
      }
    }
  }

  /**
   * Soft collision between enemies only: allied units walk through each other in the
   * village (no traffic jams); enemies push each other apart (never into water/buildings).
   */
  private separate(state: GameState, movers: Mover[]): void {
    const minDist = GAME.pathfinding.separation;
    const cells = new Map<number, Mover[]>();
    for (const m of movers) {
      const k = tileKey(Math.floor(m.x), Math.floor(m.y));
      const list = cells.get(k);
      if (list) list.push(m);
      else cells.set(k, [m]);
    }
    for (const a of movers) {
      const cx = Math.floor(a.x);
      const cy = Math.floor(a.y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          for (const b of cells.get(tileKey(cx + ox, cy + oy)) ?? []) {
            if (b.id <= a.id || !enemies(state, a.ownerId, b.ownerId)) continue;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= minDist) continue;
            if (d < 1e-4) {
              // Exactly on top of each other: split along a stable direction.
              const angle = (hashId(a.id) - hashId(b.id)) * 2.39996;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              d = 1;
            }
            const push = ((minDist - Math.min(d, minDist)) / 2) * 0.5;
            // Walking movers keep their course; standing ones make room.
            const wa = a.path.length > 0 && b.path.length === 0 ? 0.25 : 1;
            const wb = b.path.length > 0 && a.path.length === 0 ? 0.25 : 1;
            this.nudge(state, a, (-dx / d) * push * wa, (-dy / d) * push * wa);
            this.nudge(state, b, (dx / d) * push * wb, (dy / d) * push * wb);
          }
        }
      }
    }
  }

  private nudge(state: GameState, m: Mover, dx: number, dy: number): void {
    const nx = m.x + dx;
    const ny = m.y + dy;
    const from = tileOf(m);
    const to = tileOf({ x: nx, y: ny });
    if ((to.tx !== from.tx || to.ty !== from.ty) && !this.walkable(state, to.tx, to.ty)) return;
    m.x = nx;
    m.y = ny;
  }

  private path(state: GameState, m: Mover, isGoal: (tx: number, ty: number) => boolean, hint: TilePos): TilePos[] {
    this.refreshBlocked(state);
    return findPath((x, y) => this.walkable(state, x, y), tileOf(m), isGoal, hint);
  }

  private refreshBlocked(state: GameState): void {
    const list = Object.values(state.buildings);
    const signature = `${list.length}:${list.length > 0 ? list[list.length - 1].id : ''}`;
    if (signature === this.blockedSignature) return;
    const known = new Set(this.knownBuildings);
    this.knownBuildings = list.map((b) => b.id);
    this.blockedSignature = signature;
    this.blocked.clear();
    for (const b of list) {
      // Army camps are open ground: soldiers stand inside.
      if (b.type === 'armyCamp') continue;
      const size = BUILDINGS[b.type].size;
      for (let y = b.ty; y < b.ty + size; y++) for (let x = b.tx; x < b.tx + size; x++) this.blocked.add(tileKey(x, y));
    }
    for (const b of list) if (!known.has(b.id)) this.evictFrom(state, b);
  }
}

function touches(b: Building, size: number, tx: number, ty: number): boolean {
  const inside = tx >= b.tx && tx < b.tx + size && ty >= b.ty && ty < b.ty + size;
  return !inside && tx >= b.tx - 1 && tx <= b.tx + size && ty >= b.ty - 1 && ty <= b.ty + size;
}

function enemies(state: GameState, a: string, b: string): boolean {
  return a !== b && !state.villages[a]?.allies.includes(b);
}

const hashId = (id: string): number => Number(id.split('-')[1]) || 0;
