import { BUILDINGS, WEAPONS } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { GameState, WeaponType } from '../core/types';
import { spend } from './EconomySystem';
import { assignWorkers, staffing } from './PopulationSystem';

/** Pays the weapon cost and adds it to the forge queue. Needs a completed armory. */
export function queueWeapon(state: GameState, villageId: string, weapon: WeaponType): boolean {
  const hasArmory = Object.values(state.buildings).some(
    (b) => b.ownerId === villageId && b.buildProgress >= 1 && BUILDINGS[b.type].forges?.includes(weapon),
  );
  if (!hasArmory) return false;
  const village = state.villages[villageId];
  if (!spend(village, WEAPONS[weapon].cost)) return false;
  village.forgeQueue.push({ weapon, remainingMs: WEAPONS[weapon].forgeTimeMs });
  return true;
}

/** Forging speed = sum of armory staffing ratios (no workers → no forging). */
export class ArmorySystem {
  constructor(private bus?: EventBus) {}

  update(state: GameState, dtMs: number): void {
    for (const village of Object.values(state.villages)) {
      if (!village.alive || village.forgeQueue.length === 0) continue;
      const assignment = assignWorkers(state, village.id);
      const speed = Object.values(state.buildings)
        .filter((b) => b.ownerId === village.id && b.buildProgress >= 1 && BUILDINGS[b.type].forges)
        .reduce((sum, b) => sum + staffing(b, assignment), 0);
      let budget = dtMs * speed;
      while (budget > 0 && village.forgeQueue.length > 0) {
        const item = village.forgeQueue[0];
        const used = Math.min(budget, item.remainingMs);
        item.remainingMs -= used;
        budget -= used;
        if (item.remainingMs <= 0) {
          village.forgeQueue.shift();
          village.weapons[item.weapon] += 1;
          this.bus?.emit('weapons:changed', { villageId: village.id, weapons: { ...village.weapons } });
        }
      }
    }
  }
}
