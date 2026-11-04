import { AI, BUILDINGS, GAME, UNITS, VILLAGER } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import { townHallOf } from '../core/GameState';
import type { Building, BuildingType, GameState, ResourceType, UnitType, Village, Villager } from '../core/types';
import { placeBuilding, orderBuildingWork, type TileSource } from './ConstructionSystem';
import { nearestResourceTiles, orderHarvest } from './GatherSystem';
import type { MovementSystem } from './MovementSystem';
import { capacityOf, populationOf, queueTraining, reservedOf } from './TrainingSystem';
import { queueAge, queueResearch } from './ProgressionSystem';
import { armyPower, areAllied, canSpare, proposeAlliance, sendResources } from './DiplomacySystem';
import { orderAttack, isEnemy } from './CombatSystem';
import { sendArmy } from './ArmySystem';
import { bus as gameBus, type EventBus } from '../core/EventBus';

/** Decisions issue the same orders as a player; no resources or units are created here. */
export class AISystem {
  private elapsed = 0;
  constructor(private world: TileSource, private movement: MovementSystem, private bus: EventBus = gameBus) {}
  update(state: GameState, dtMs: number): void {
    this.elapsed += dtMs;
    if (this.elapsed < AI.thinkIntervalMs) return;
    this.elapsed %= AI.thinkIntervalMs;
    for (const village of Object.values(state.villages)) {
      if (village.id === PLAYER_ID || !village.alive) continue;
      const hall = townHallOf(state, village.id);
      if (!hall) continue;
      this.discover(state, village, hall);
      this.economy(state, village, hall);
      this.diplomacy(state, village);
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
      else if (!has('farm') && !Object.values(state.foodSources).some(s => s.remaining > 0 && Math.hypot(s.tx-hall.tx, s.ty-hall.ty) <= VILLAGER.searchRadius)) type = 'farm';
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
    const kind = type === 'mill' ? 'food' : type === 'lumberCamp' ? 'wood' : type === 'minerCamp' ? 'stone' : null;
    const worker = kind && Object.values(state.villagers).find(v => v.ownerId === owner && v.harvest && (kind === 'food' ? !!v.harvest.sourceType : this.movement.tile(v.harvest.tx, v.harvest.ty) === (kind === 'wood' ? 'forest' : 'rock')));
    const center = worker?.harvest ?? hall;
    for (let r = 1; r <= GAME.buildRadius; r++) for (let y = center.ty-r; y <= center.ty+r; y++) for (let x = center.tx-r; x <= center.tx+r; x++) {
      if (Math.max(Math.abs(x-center.tx), Math.abs(y-center.ty)) === r && placeBuilding(state, this.world, type, x, y, owner).ok) return;
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
    const ratios = AI.resourceRatios[village.age];
    const available = workers.filter(v => !v.jobId && v.task !== 'goto');
    for (const w of available) {
      const current = resource(w);
      if (current && (w.carrying || counts[current] <= Math.ceil(available.length * ratios[current]))) continue;
      const choices = (['food', 'wood', 'stone', 'iron'] as ResourceType[]).sort((a,b) =>
        (available.length * ratios[b] - counts[b]) - (available.length * ratios[a] - counts[a]));
      for (const r of choices) {
        if (current && (r === current || counts[r] >= Math.floor(available.length * ratios[r]))) break;
        const targets = r === 'food' ? [...Object.values(state.foodSources).filter(s => s.remaining > 0), ...Object.values(state.buildings).filter(b => b.ownerId === village.id && b.type === 'farm' && b.buildProgress >= 1)].sort((a,b) => Math.hypot(a.tx-w.x,a.ty-w.y)-Math.hypot(b.tx-w.x,b.ty-w.y)).slice(0, AI.sourceCandidates) : nearestResourceTiles(state, this.movement, w.x, w.y, r === 'wood' ? 'forest' : r === 'stone' ? 'rock' : 'iron', AI.sourceCandidates);
        if (targets.some(t => orderHarvest(state, this.movement, [w], t.tx, t.ty))) { if (current) counts[current]--; counts[r]++; break; }
      }
    }
  }
  private discover(state: GameState, village: Village, hall: Building): void {
    const known = village.knownVillages ??= [];
    const sources = [...Object.values(state.buildings).filter(b => b.ownerId === village.id).map(b => ({x:b.tx,y:b.ty,range:BUILDINGS[b.type].vision})), ...Object.values(state.units).filter(u => u.ownerId === village.id).map(u => ({x:u.x,y:u.y,range:UNITS[u.type].vision})), ...Object.values(state.villagers).filter(v => v.ownerId === village.id).map(v => ({x:v.x,y:v.y,range:VILLAGER.vision}))];
    const unknown = Object.values(state.villages).filter(v => v.alive && v.id !== village.id && !known.includes(v.id)).map(v => ({v, hall:townHallOf(state,v.id)})).filter((t): t is {v: Village; hall: Building} => !!t.hall);
    for (const t of unknown) if (state.timeMs >= AI.discoveryDelayMs || sources.some(s => Math.hypot(s.x-t.hall.tx,s.y-t.hall.ty) <= s.range)) known.push(t.v.id);
    if (state.timeMs < AI.scoutStartMs || state.timeMs >= AI.discoveryDelayMs || Object.values(state.villagers).some(v => v.ownerId === village.id && v.task === 'goto')) return;
    const target = unknown.filter(t => !known.includes(t.v.id)).sort((a,b) => Math.hypot(a.hall.tx-hall.tx,a.hall.ty-hall.ty)-Math.hypot(b.hall.tx-hall.tx,b.hall.ty-hall.ty))[0];
    const scout = Object.values(state.villagers).find(v => v.ownerId === village.id && !v.inside && !v.jobId && !v.carrying);
    if (target && scout && this.movement.moveNextTo(state, scout, target.hall)) { scout.harvest = null; scout.task = 'goto'; }
  }
  private diplomacy(state: GameState, village: Village): void {
    if (village.personality !== 'diplomat' || state.timeMs < AI.diplomacyIntervalMs) return;
    const key = `ai-diplomacy:${village.id}`;
    if ((state.diplomacy.cooldowns[key] ?? 0) > state.timeMs) return;
    state.diplomacy.cooldowns[key] = state.timeMs + AI.diplomacyIntervalMs;
    const target = (village.knownVillages ?? []).map(id => state.villages[id]).find(v => v?.alive && v.id !== PLAYER_ID && !areAllied(state, village.id, v.id));
    if (target) proposeAlliance(state, village.id, target.id, this.bus);
    const ally = village.allies.find(id => state.villages[id]?.alive);
    if (ally && canSpare(state, village.id, AI.diplomacy.giftPack)) sendResources(state, village.id, ally, this.bus);
  }

  private military(state: GameState, village: Village, hall: Building): void {
    const personality = AI.personalities[village.personality ?? 'economic'];
    const units = Object.values(state.units).filter(u => u.ownerId === village.id);
    const barracks = Object.values(state.buildings).filter(b => b.ownerId === village.id && b.type === 'barracks' && b.buildProgress >= 1);
    for (const b of barracks) if ((village.age > 1 || units.length < AI.ageOneArmyLimit) && (b.trainingQueue?.length ?? 0) < 1 && Object.values(state.villagers).filter(v => v.ownerId === village.id).length >= AI.minWorkers) {
      const types: UnitType[] = village.age >= 2 ? ['knight', 'archer'] : ['spearman'];
      types.sort((a,b) => units.filter(u => u.type === a).length / (personality.unitMix[a] ?? 1) - units.filter(u => u.type === b).length / (personality.unitMix[b] ?? 1));
      for (const type of types) if (queueTraining(state, b.id, type)) break;
    }
    const armory = Object.values(state.buildings).find(b => b.ownerId === village.id && b.type === 'armory' && b.buildProgress >= 1);
    if (armory) { queueResearch(state, armory.id, 'sharpIron'); queueResearch(state, armory.id, 'rivetedMail'); queueResearch(state, armory.id, 'reinforcedBolts'); }
    const threat = Object.values(state.units).find(u => isEnemy(state, village.id, u.ownerId) && Math.hypot(u.x-hall.tx,u.y-hall.ty) <= GAME.combat.defendRadius);
    if (threat) { orderAttack(state, units.map(u => u.id), threat.id); return; }
    if (units.length < AI.minimumAttackUnits || units.some(u => u.ordered)) return;
    if (state.timeMs < AI.attackStartMs) return;
    const targets = Object.values(state.villages).filter(v => v.alive && v.id !== village.id && !areAllied(state, village.id, v.id) && village.knownVillages?.includes(v.id)).map(v => ({ village:v, hall:townHallOf(state,v.id) })).filter((t): t is { village: Village; hall: Building } => !!t.hall);
    targets.sort((a,b) => personality.targetPreference === 'weakest' ? armyPower(state,a.village.id)-armyPower(state,b.village.id) : Math.hypot(a.hall.tx-hall.tx,a.hall.ty-hall.ty)-Math.hypot(b.hall.tx-hall.tx,b.hall.ty-hall.ty));
    const target = targets[0];
    if (target && armyPower(state,village.id) >= personality.attackThreshold * armyPower(state,target.village.id)) {
      const ids = units.map(u => u.id); sendArmy(state, this.movement, ids, {tx:target.hall.tx,ty:target.hall.ty}); orderAttack(state, ids, target.hall.id);
    }
  }
}
