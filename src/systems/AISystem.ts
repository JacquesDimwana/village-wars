import { AI, GAME } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import { townHallOf } from '../core/GameState';
import type { GameState } from '../core/types';
import { placeBuilding, type TileSource } from './ConstructionSystem';
import { nearestResourceTiles, orderHarvest } from './GatherSystem';
import type { MovementSystem } from './MovementSystem';
import { capacityOf, populationOf, queueTraining, reservedOf } from './TrainingSystem';
import { listIdleVillagers } from './VillagerSystem';

/** Minimal economy: all decisions use the same orders and costs as the player. */
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
      const pop = populationOf(state, village.id) + reservedOf(state, village.id);
      if (pop < AI.workerTarget) queueTraining(state, hall.id, 'villager');
      if (pop / capacityOf(state, village.id) >= AI.housingThreshold && !Object.values(state.buildings).some(b => b.ownerId === village.id && b.type === 'house' && b.buildProgress < 1)) {
        let placed = false;
        for (let r = 1; r <= GAME.buildRadius && !placed; r++) for (let y = hall.ty - r; y <= hall.ty + r && !placed; y++) for (let x = hall.tx - r; x <= hall.tx + r && !placed; x++) {
          if (Math.max(Math.abs(x - hall.tx), Math.abs(y - hall.ty)) !== r) continue;
          placed = placeBuilding(state, this.world, 'house', x, y, village.id).ok;
        }
      }
      for (const v of listIdleVillagers(state, village.id)) {
        const workers = Object.values(state.villagers).filter(w => w.ownerId === village.id && w.harvest);
        const food = workers.filter(w => w.harvest?.sourceType === 'berry' || w.harvest?.sourceType === 'animal').length;
        const wood = workers.length - food;
        const berries = Object.values(state.foodSources).filter(s => s.type === 'berry' && s.remaining > 0).sort((a,b) => Math.hypot(a.tx-v.x,a.ty-v.y)-Math.hypot(b.tx-v.x,b.ty-v.y));
        const trees = nearestResourceTiles(state, this.movement, v.x, v.y, 'forest', AI.sourceCandidates);
        const targets = food <= wood ? [...berries, ...trees] : [...trees, ...berries];
        for (const target of targets) {
          if (this.movement.moveTo(state, v, target.tx, target.ty)) { orderHarvest(state, this.movement, [v], target.tx, target.ty); break; }
        }
      }
    }
  }
}
