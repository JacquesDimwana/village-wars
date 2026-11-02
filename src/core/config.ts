import gameJson from '../config/game.json';
import resourcesJson from '../config/resources.json';
import buildingsJson from '../config/buildings.json';
import unitsJson from '../config/units.json';
import progressionJson from '../config/progression.json';
import aiJson from '../config/ai.json';
import type { BuildingType, Cost, Personality, ResourceType, UnitType, WeaponType } from './types';

export interface BuildingDef {
  name: string;
  size: number;
  hp: number;
  cost: Cost;
  buildTimeMs: number;
  vision: number;
  population?: number;
  produces?: Partial<Record<ResourceType, number>>;
  smelts?: boolean;
  /** Jobs offered. Production scales with filled slots / workerSlots. */
  workerSlots?: number;
  forges?: WeaponType[];
  converts?: UnitType[];
  attack?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  levels?: { level: number; cost: Cost; hpBonus?: number; population?: number }[];
  /** Army camp: soldier figurines drawn at most (the rest are only counted). */
  visibleSoldiers?: number;
}

export interface UnitDef {
  name: string;
  /** Weapon consumed (with 1 inhabitant) to create this unit. */
  cost: Cost;
  trainTimeMs: number;
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

export const PROGRESSION = progressionJson as unknown as { ages: Record<2 | 3, { name: string; cost: Cost; durationMs: number; requires: BuildingType[] }>; upgrades: Record<import('./types').UpgradeType, { name: string; age: number; cost: Cost; durationMs: number; attack: number; hp: number; units: UnitType[] }>; buildingAge: Partial<Record<BuildingType, number>>; unitAge: Partial<Record<UnitType, number>> };
export const GAME = gameJson;
export const RESOURCES = resourcesJson;
export const BUILDINGS = buildingsJson as unknown as Record<BuildingType, BuildingDef>;

const { counterMultiplier, villager, ...unitDefs } = unitsJson;
export const COUNTER_MULTIPLIER = counterMultiplier;
/** Visible civilian (not a UnitType: villagers don't fight and aren't in `state.units`). */
export const VILLAGER = villager;
export const UNITS = unitDefs as unknown as Record<UnitType, UnitDef>;

export const AI = aiJson as unknown as {
  thinkIntervalMs: number;
  workerTarget: number;
  sourceCandidates: number;
  /** AI keeps at least this many civilians working before converting warriors. */
  minWorkers: number;
  housingThreshold: number;
  personalities: Record<Personality, PersonalityDef>;
  assignment: Personality[];
};
