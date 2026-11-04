import { AI, BUILDINGS, GAME, UNITS, VILLAGER } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import { townHallOf } from '../core/GameState';
import type { Building, BuildingType, GameState, ResourceType, UnitType, Village, Villager } from '../core/types';
import { placeBuilding, orderBuildingWork, type TileSource } from './ConstructionSystem';
import { nearestResourceTiles, orderHarvest } from './GatherSystem';
import type { MovementSystem } from './MovementSystem';
import { capacityOf, populationOf, queueTraining, reservedOf } from './TrainingSystem';
import { queueAge, queueResearch } from './ProgressionSystem';
import { armyPower, areAllied } from './DiplomacySystem';
import { orderAttack, isEnemy } from './CombatSystem';
import { sendArmy } from './ArmySystem';

/** Decisions issue the same orders as a player; no resources or units are created here. */
export class AISystem {
  private elapsed = 0;
  constructor(private world: TileSource, private movement: MovementSystem) {}
  update(state: GameState, dtMs: number): void {
    this.elapsed += dtMs;
    if (this.elapsed < AI.thinkIntervalMs) return;
    this.elapsed %= AI.thinkIntervalMs;
    for (const village of Object.values(state.villages)) {
      if (village.id === PLAYER_ID || !village.alive) continue;
      const hall = townHallOf(state, village.id);
      if (!hall) continue;
      this.economy(state, village, hall);
      this.military(state, village, hall);
    }
  }
  private economy(state: GameState, village: Village, hall: Building): void {
    const buildings = Object.values(state.buildings).filter(b => b.ownerId === village.id);
    const workers = Object.values(state.villagers).filter(v => v.ownerId === village.id && !v.inside);
    const has = (type: BuildingType) => buildings.some(b => b.type === type);
    const complete = (type: BuildingType) => buildings.some(b => b.type === type && b.buildProgress >= 1);
    if (workers.length >= AI.minWorkers && (hall.trainingQueue?.length ?? 0) === 0) queueAge(state, hall.id);
    if (workers.length < AI.workerTarget && (hall.trainingQueue?.length ?? 0) < 1) queueTraining(state, hall.id, 'villager');
    const pop = populationOf(state, village.id) + reservedOf(state, village.id);
    const pending = buildings.some(b => b.buildProgress < 1);
    if (!pending) {
      let type: BuildingType | undefined;
      if (pop / capacityOf(state, village.id) >= AI.housingThreshold) type = 'house';
      else if (!has('barracks') && (village.personality === 'aggressive' || workers.length >= AI.minWorkers)) type = 'barracks';
      else if (!has('mill')) type = 'mill';
      else if (!has('lumberCamp') && workers.length >= AI.minWorkers) type = 'lumberCamp';
      else if (!has('armyCamp') && complete('barracks')) type = 'armyCamp';
      else if (village.age >= 2 && !has('armory')) type = 'armory';
      else if (village.age >= 2 && !has('minerCamp')) type = 'minerCamp';
      else if (village.age >= 2 && !has('tower')) type = 'tower';
      if (type) this.place(state, hall, type, village.id);
    }
    const site = buildings.find(b => b.buildProgress < 1);
    if (site && !workers.some(v => v.jobId === site.id)) {
      const candidates = [...workers].sort((a, b) => Number(a.task !== 'idle') - Number(b.task !== 'idle'));
      for (const v of candidates) if (orderBuildingWork(state, this.movement, [v], site)) break;
    }
    const damaged = buildings.find(b => b.buildProgress >= 1 && b.hp < b.maxHp * AI.repairThreshold);
    if (damaged && !workers.some(v => v.jobId === damaged.id)) {
      const idle = workers.find(v => v.task === 'idle' && !v.harvest);
      if (idle) orderBuildingWork(state, this.movement, [idle], damaged);
    }
    this.assign(state, village, workers);
  }
  private place(state: GameState, hall: Building, type: BuildingType, owner: string): void {
    for (let r = 1; r <= GAME.buildRadius; r++) for (let y = hall.ty-r; y <= hall.ty+r; y++) for (let x = hall.tx-r; x <= hall.tx+r; x++) {
      if (Math.max(Math.abs(x-hall.tx), Math.abs(y-hall.ty)) === r && placeBuilding(state, this.world, type, x, y, owner).ok) return;
    }
  }
  private assign(state: GameState, village: Village, workers: Villager[]): void {
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, stone: 0, iron: 0 };
    const resource = (v: Villager): ResourceType | null => {
      if (!v.harvest) return null;
      if (v.harvest.sourceType) return 'food';
      const tile = this.movement.tile(v.harvest.tx, v.harvest.ty);
      return tile === 'forest' ? 'wood' : tile === 'rock' ? 'stone' : tile === 'iron' ? 'iron' : null;
    };
    for (const w of workers) { const r = resource(w); if (r) counts[r]++; }
    for (const w of workers.filter(v => !v.jobId && !v.harvest)) {
      const choices = (['food', 'wood', 'stone', 'iron'] as ResourceType[]).sort((a,b) =>
        (counts[a] + 1) * (village.resources[a] + AI.resourceBias[a]) / AI.resourceWeight[a] - (counts[b] + 1) * (village.resources[b] + AI.resourceBias[b]) / AI.resourceWeight[b]);
      for (const r of choices) {
        const targets = r === 'food' ? Object.values(state.foodSources).filter(s => s.remaining > 0).sort((a,b) => Math.hypot(a.tx-w.x,a.ty-w.y)-Math.hypot(b.tx-w.x,b.ty-w.y)).slice(0, AI.sourceCandidates) : nearestResourceTiles(state, this.movement, w.x, w.y, r === 'wood' ? 'forest' : r === 'stone' ? 'rock' : 'iron', AI.sourceCandidates);
        if (targets.some(t => orderHarvest(state, this.movement, [w], t.tx, t.ty))) { counts[r]++; break; }
      }
    }
  }
  private military(state: GameState, village: Village, hall: Building): void {
    const personality = AI.personalities[village.personality ?? 'economic'];
    const units = Object.values(state.units).filter(u => u.ownerId === village.id);
    const barracks = Object.values(state.buildings).filter(b => b.ownerId === village.id && b.type === 'barracks' && b.buildProgress >= 1);
    for (const b of barracks) if ((b.trainingQueue?.length ?? 0) < 1 && Object.values(state.villagers).filter(v => v.ownerId === village.id).length >= AI.minWorkers) {
      const types: UnitType[] = village.age >= 2 ? ['knight', 'archer'] : ['spearman'];
      types.sort((a,b) => units.filter(u => u.type === a).length / (personality.unitMix[a] ?? 1) - units.filter(u => u.type === b).length / (personality.unitMix[b] ?? 1));
      for (const type of types) if (queueTraining(state, b.id, type)) break;
    }
    const armory = Object.values(state.buildings).find(b => b.ownerId === village.id && b.type === 'armory' && b.buildProgress >= 1);
    if (armory) { queueResearch(state, armory.id, 'sharpIron'); queueResearch(state, armory.id, 'rivetedMail'); queueResearch(state, armory.id, 'reinforcedBolts'); }
    const threat = Object.values(state.units).find(u => isEnemy(state, village.id, u.ownerId) && Math.hypot(u.x-hall.tx,u.y-hall.ty) <= GAME.combat.defendRadius);
    if (threat) { orderAttack(state, units.map(u => u.id), threat.id); return; }
    if (!units.length || units.some(u => u.ordered)) return;
    const sources = [...Object.values(state.buildings).filter(b => b.ownerId === village.id).map(b => ({ x:b.tx, y:b.ty, range:BUILDINGS[b.type].vision })), ...units.map(u => ({ x:u.x, y:u.y, range:UNITS[u.type].vision })), ...Object.values(state.villagers).filter(v => v.ownerId === village.id).map(v => ({x:v.x,y:v.y,range:VILLAGER.vision}))];
    const targets = Object.values(state.villages).filter(v => v.alive && v.id !== village.id && !areAllied(state, village.id, v.id)).map(v => ({ village:v, hall:townHallOf(state,v.id) })).filter((t): t is { village: Village; hall: Building } => !!t.hall && sources.some(s => Math.hypot(s.x-t.hall!.tx,s.y-t.hall!.ty) <= s.range));
    targets.sort((a,b) => personality.targetPreference === 'weakest' ? armyPower(state,a.village.id)-armyPower(state,b.village.id) : Math.hypot(a.hall.tx-hall.tx,a.hall.ty-hall.ty)-Math.hypot(b.hall.tx-hall.tx,b.hall.ty-hall.ty));
    const target = targets[0];
    if (target && armyPower(state,village.id) >= personality.attackThreshold * armyPower(state,target.village.id)) {
      const ids = units.map(u => u.id); sendArmy(state, this.movement, ids, {tx:target.hall.tx,ty:target.hall.ty}); orderAttack(state, ids, target.hall.id);
    }
  }
}
