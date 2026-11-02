import gameJson from '../config/game.json';
import resourcesJson from '../config/resources.json';
import buildingsJson from '../config/buildings.json';
import unitsJson from '../config/units.json';
import aiJson from '../config/ai.json';
import type { BuildingType, Cost, Personality, ResourceType, TileType, UnitType, WeaponType } from './types';

export interface BuildingDef {
  name: string;
  size: number;
  hp: number;
  cost: Cost;
  buildTimeMs: number;
  vision: number;
  population?: number;
  produces?: Partial<Record<ResourceType, number>>;
  requiresNearbyTile?: { type: TileType; radius: number };
  smelts?: boolean;
  /** Jobs offered. Production scales with filled slots / workerSlots. */
  workerSlots?: number;
  forges?: WeaponType[];
  converts?: UnitType[];
  attack?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  levels?: { level: number; cost: Cost; hpBonus?: number; population?: number }[];
}

export interface UnitDef {
  name: string;
  /** Weapon consumed (with 1 inhabitant) to create this unit. */
  weapon: WeaponType;
  hp: number;
  attack: number;
  range: number;
  attackCooldownMs: number;
  speed: number;
  aggroRange: number;
  vision: number;
  military: boolean;
  strongAgainst?: UnitType[];
  buildingDamageMultiplier?: number;
  attacksUnits?: boolean;
}

export interface PersonalityDef {
  name: string;
  barracksPriority: number;
  attackThreshold: number;
  unitMix: Partial<Record<UnitType, number>>;
  baseAcceptance: number;
  targetPreference: 'weakest' | 'closest';
}

export const GAME = gameJson;
export interface WeaponDef {
  name: string;
  cost: Cost;
  forgeTimeMs: number;
}

export const RESOURCES = resourcesJson;
export const WEAPONS = resourcesJson.weapons as Record<WeaponType, WeaponDef>;
export const BUILDINGS = buildingsJson as unknown as Record<BuildingType, BuildingDef>;

const { counterMultiplier, ...unitDefs } = unitsJson;
export const COUNTER_MULTIPLIER = counterMultiplier;
export const UNITS = unitDefs as unknown as Record<UnitType, UnitDef>;

export const AI = aiJson as unknown as {
  thinkIntervalMs: number;
  /** AI keeps at least this many civilians working before converting warriors. */
  minWorkers: number;
  housingThreshold: number;
  personalities: Record<Personality, PersonalityDef>;
  assignment: Personality[];
  diplomacy: DiplomacyDef;
};

export interface DiplomacyDef {
  powerWeight: number;
  acceptThreshold: number;
  /** Caps (your power / their power) so a huge army can't buy every alliance. */
  maxPowerRatio: number;
  refusalPenalty: number;
  proposalCooldownMs: number;
  giftPack: Cost;
  giftRelation: number;
  requestPack: Cost;
  requestCooldownMs: number;
  requestRelationCost: number;
  /** Stock an ally keeps for itself; it gives only above 2× this. */
  needs: Cost;
  reinforcementShare: number;
  breakPenalty: number;
  /** Convoy speed in tiles per second. */
  convoySpeed: number;
}
