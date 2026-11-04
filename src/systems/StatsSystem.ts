import { GAME } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/types';


/**
 * Player statistics for the end screen, fed by game events:
 * gathered resources (`resources:changed.gained`), enemy villages destroyed
 * (`village:destroyed`) and completed villager and soldier training (`unit:trained`).
 */
export class StatsSystem {
  private gathered = 0;
  private destroyed = 0;
  private trained = 0;

  constructor(bus: EventBus) {
    bus.on('resources:changed', ({ villageId, gained }) => {
      if (villageId === PLAYER_ID && gained) this.gathered += gained;
    });
    bus.on('unit:trained', ({ villageId }) => { if (villageId === PLAYER_ID) this.trained++; });
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

    stats.unitsTrained += this.trained;
    this.trained = 0;
  }
}

/** 1–3 stars on victory depending on game time (thresholds in game.json), 0 on defeat. */
export function victoryStars(state: GameState): number {
  if (state.status !== 'won') return 0;
  const minutes = state.timeMs / 60000;
  const [three, two] = GAME.endgame.victoryStarsMinutes;
  return minutes <= three ? 3 : minutes <= two ? 2 : 1;
}
