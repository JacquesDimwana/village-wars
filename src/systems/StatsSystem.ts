import { GAME } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/types';

const unitSeq = (id: string): number => Number(id.slice(id.lastIndexOf('-') + 1)) || 0;

/**
 * Player statistics for the end screen, fed by game events:
 * gathered resources (`resources:changed.gained`), enemy villages destroyed
 * (`village:destroyed`) and newly trained units (unit ids only grow).
 */
export class StatsSystem {
  private gathered = 0;
  private destroyed = 0;

  constructor(bus: EventBus) {
    bus.on('resources:changed', ({ villageId, gained }) => {
      if (villageId === PLAYER_ID && gained) this.gathered += gained;
    });
    bus.on('village:destroyed', ({ villageId }) => {
      if (villageId !== PLAYER_ID) this.destroyed += 1;
    });
  }

  /** Run after the other systems so this tick's events are counted. */
  update(state: GameState): void {
    const stats = state.stats;
    stats.resourcesGathered += this.gathered;
    stats.villagesDestroyed += this.destroyed;
    this.gathered = this.destroyed = 0;

    let last = stats.lastUnitSeq;
    for (const u of Object.values(state.units)) {
      if (u.ownerId !== PLAYER_ID) continue;
      const seq = unitSeq(u.id);
      if (seq <= stats.lastUnitSeq) continue;
      stats.unitsTrained += 1;
      last = Math.max(last, seq);
    }
    stats.lastUnitSeq = last;
  }
}

/** 1–3 stars on victory depending on game time (thresholds in game.json), 0 on defeat. */
export function victoryStars(state: GameState): number {
  if (state.status !== 'won') return 0;
  const minutes = state.timeMs / 60000;
  const [three, two] = GAME.endgame.victoryStarsMinutes;
  return minutes <= three ? 3 : minutes <= two ? 2 : 1;
}
