export type ResourceType = 'wood' | 'stone' | 'ore' | 'iron';
export type Resources = Record<ResourceType, number>;
export type Cost = Partial<Resources>;

export type TileType = 'water' | 'sand' | 'grass' | 'forest' | 'rock' | 'ore';

export type BuildingType =
  | 'townHall'
  | 'house'
  | 'lumberCamp'
  | 'quarry'
  | 'mine'
  | 'smelter'
  | 'barracks'
  | 'armory'
  | 'tower';

export type UnitType = 'knight' | 'archer';
export type WeaponType = 'sword' | 'bow';

export type Personality = 'aggressive' | 'economic' | 'diplomat';

export interface TilePos {
  tx: number;
  ty: number;
}

export interface Building {
  id: string;
  type: BuildingType;
  ownerId: string;
  /** Top-left tile. */
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
  level: number;
  /** 0..1 — production and effects only apply at 1. */
  buildProgress: number;
}

/** Anything that walks on the grid (warriors and villagers). Handled by MovementSystem. */
export interface Mover {
  id: string;
  ownerId: string;
  /** Continuous tile coordinates (unit can be between tiles). Tile = floor(x + 0.5). */
  x: number;
  y: number;
  /** Remaining tiles to walk through (A* result), next one first. Empty = standing. */
  path: TilePos[];
}

export interface Unit extends Mover {
  type: UnitType;
  hp: number;
  maxHp: number;
}

/**
 * What a villager is doing. Auto jobs only *show* the building's production (no credit);
 * `harvest` (player order) really gathers the tile and credits the village at drop-off.
 */
export type VillagerTask = 'idle' | 'toWork' | 'working' | 'returning' | 'wander' | 'goto';

export interface Villager extends Mover {
  /** Building the villager currently works for (auto assignment, see assignWorkers). */
  jobId: string | null;
  /** Player pinned this villager to a building: it gets a slot there first. */
  pinnedJobId: string | null;
  /** Player order: gather this tile (the villager leaves its job). */
  harvest: TilePos | null;
  task: VillagerTask;
  /** Tile the current trip goes to (resource tile, building, wander spot). */
  target: TilePos | null;
  /** Time left in the current work / pause, ms. */
  timerMs: number;
  /** Resource carried (shown above the head). Only `harvest` loads are credited. */
  carrying: { type: ResourceType; amount: number } | null;
}

export interface Village {
  id: string;
  name: string;
  isPlayer: boolean;
  personality?: Personality;
  color: number;
  resources: Resources;
  /** Fractional accumulators so slow production rates are not lost to rounding. */
  production: Resources;
  smelterTimerMs: number;
  /** Civilians (fractional while growing). Only floor(inhabitants) are counted as workers. */
  inhabitants: number;
  /** Forged weapons in stock, consumed when converting an inhabitant into a warrior. */
  weapons: Record<WeaponType, number>;
  /** Armory queue, front item progresses first. */
  forgeQueue: { weapon: WeaponType; remainingMs: number }[];
  alive: boolean;
  /** Ids of allied villages. */
  allies: string[];
  /** Relation score per village id, -1..1. */
  relations: Record<string, number>;
}

export interface GameState {
  seed: number;
  timeMs: number;
  villages: Record<string, Village>;
  buildings: Record<string, Building>;
  units: Record<string, Unit>;
  /** Visible civilians (one per whole inhabitant). Kept in sync by VillagerSystem. */
  villagers: Record<string, Villager>;
  nextId: number;
  /** Remaining resource amount for tiles that have been harvested. Key: "tx,ty". */
  depletion: Record<string, number>;
  /** Tiles explored by the player (minimap / fog of war). */
  fog: FogState;
  status: 'playing' | 'won' | 'lost';
}

export interface FogState {
  /** One bitmap per chunk (1 = explored), row-major. Key: "cx,cy". */
  explored: Record<string, Uint8Array>;
  /** Current exploration radius per player building id (grows while its workers forage). */
  radius: Record<string, number>;
  /** Incremented whenever new tiles get explored, so renderers can skip redraws. */
  version: number;
}
