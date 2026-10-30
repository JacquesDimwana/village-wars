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

export interface Unit {
  id: string;
  type: UnitType;
  ownerId: string;
  /** Continuous tile coordinates (unit can be between tiles). */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
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
