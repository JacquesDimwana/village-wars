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
  | 'tower'
  | 'armyCamp';

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
  /** Defense tower: what it shoots at and when it may shoot again (state.timeMs). */
  targetId?: string | null;
  nextAttackMs?: number;
  lastAttackMs?: number;
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
  /** Army camp this soldier rests in (null = waits in front of the barracks). */
  campId: string | null;
  /** Sent out by the player / AI: walks freely and is always drawn. False = resting at camp. */
  onMission: boolean;
  /** Delay before leaving the camp (soldiers exit one by one, in a column), ms. */
  departMs: number;
  /** Mission destination, applied when departMs reaches 0. */
  missionTarget: TilePos | null;
  /** Enemy unit / villager / building being attacked (CombatSystem). */
  targetId: string | null;
  /** True when the player / AI ordered this target: chased anywhere, never swapped. */
  ordered: boolean;
  /** Earliest state.timeMs of the next hit. */
  nextAttackMs: number;
  /** state.timeMs of the last hit (renderer plays the attack clip from it). */
  lastAttackMs: number;
  /** Next state.timeMs the chase path may be recomputed. */
  repathAtMs: number;
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
  /** False for the starting workers: they can never be turned into warriors. */
  enlistable: boolean;
  /** Works "inside" its building: counted, simulated cheaply, not drawn (crowd cap). */
  inside: boolean;
  hp: number;
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
  /** Starting workers still alive (part of inhabitants, never enlistable). */
  founders: number;
  /** Forged weapons in stock, consumed when converting an inhabitant into a warrior. */
  weapons: Record<WeaponType, number>;
  /** Armory queue, front item progresses first. */
  forgeQueue: { weapon: WeaponType; remainingMs: number }[];
  alive: boolean;
  /** Ids of allied villages. */
  allies: string[];
  /** Relation score per village id, -1..1. */
  relations: Record<string, number>;
  /** Last attack suffered (CombatSystem): resting warriors nearby come out to defend. */
  alarm?: { x: number; y: number; untilMs: number } | null;
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
