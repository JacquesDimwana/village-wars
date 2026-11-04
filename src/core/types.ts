export type ResourceType = 'food' | 'wood' | 'stone' | 'iron';
export type Resources = Record<ResourceType, number>;
export type Cost = Partial<Resources>;

export type TileType = 'water' | 'sand' | 'grass' | 'forest' | 'rock' | 'iron';

export type BuildingType =
  | 'townHall'
  | 'house'
  | 'lumberCamp'
  | 'minerCamp'
  | 'mill'
  | 'farm'
  | 'barracks'
  | 'armory'
  | 'tower'
  | 'armyCamp';

export type UnitType = 'knight' | 'archer' | 'spearman';
export type UpgradeType = 'sharpIron' | 'rivetedMail' | 'reinforcedBolts';
export type QueueItem = { type: UnitType | 'villager' | 'age'; remainingMs: number };
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
  trainingQueue?: QueueItem[];
  researchQueue?: { type: UpgradeType; remainingMs: number }[];
  rallyPoint?: TilePos | null;
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
  harvest: (TilePos & { sourceType?: 'berry' | 'animal' | 'farm'; sourceId?: string }) | null;
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
  alive: boolean;
  age: 1 | 2 | 3;
  upgrades: UpgradeType[];
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
  foodSources: Record<string, { id: string; type: 'berry' | 'animal'; tx: number; ty: number; remaining: number; hits: number }>;
  nextId: number;
  /** Remaining resource amount for tiles that have been harvested. Key: "tx,ty". */
  depletion: Record<string, number>;
  /** Tiles explored by the player (minimap / fog of war). */
  fog: FogState;
  diplomacy: DiplomacyState;
  status: 'playing' | 'won' | 'lost';
  stats: GameStats;
}

/** Player statistics shown on the end screen (game time is `GameState.timeMs`). */
export interface GameStats {
  unitsTrained: number;
  /** Resources deposited by the player’s villagers. */
  resourcesGathered: number;
  /** Enemy villages eliminated (by anyone). */
  villagesDestroyed: number;
}

export interface FogState {
  /** One bitmap per chunk (1 = explored), row-major. Key: "cx,cy". */
  explored: Record<string, Uint8Array>;
  /** Current exploration radius per player building id (grows while its workers forage). */
  radius: Record<string, number>;
  /** Incremented whenever new tiles get explored, so renderers can skip redraws. */
  version: number;
  /** Tiles currently in the player's vision (1 = visible), same layout as `explored`. */
  visible: Record<string, Uint8Array>;
  /** Incremented whenever the set of visible tiles may have changed. */
  visionVersion: number;
  /** Signature of the last vision sources, to skip recomputing when nothing moved. */
  visionKey: string;
}

/** Resources travelling between two villages (gift or answered request). */
export interface Convoy {
  id: string;
  fromId: string;
  toId: string;
  resources: Cost;
  /** Current position and destination, tile coordinates. */
  x: number;
  y: number;
  destX: number;
  destY: number;
  /** True when it is a gift (raises the relation on arrival). */
  gift: boolean;
}

export interface DiplomacyState {
  convoys: Convoy[];
  /** Earliest time (state.timeMs) for the next action. Key: "action:fromId>toId". */
  cooldowns: Record<string, number>;
  /** Set once "Il ne peut en rester qu'un" fired: no more alliances. */
  lastStanding: boolean;
}
