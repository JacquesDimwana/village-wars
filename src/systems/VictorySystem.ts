import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/types';

/** A village is still standing while it owns a town hall with HP left. */
export function hasTownHall(state: GameState, villageId: string): boolean {
  return Object.values(state.buildings).some((b) => b.ownerId === villageId && b.type === 'townHall' && b.hp > 0);
}

/**
 * End conditions (GDD §11):
 * - a village without a town hall is eliminated (`alive = false`, `village:destroyed`);
 * - defeat when the player's town hall falls;
 * - victory when no rival village is left. If only allies remain, alliances
 *   break (« Il ne peut en rester qu'un ! ») and the game goes on.
 */
export class VictorySystem {
  constructor(private bus: EventBus) {}

  update(state: GameState): void {
    if (state.status !== 'playing') return;

    for (const v of Object.values(state.villages)) {
      if (!v.alive || hasTownHall(state, v.id)) continue;
      v.alive = false;
      for (const other of Object.values(state.villages)) other.allies = other.allies.filter((id) => id !== v.id);
      v.allies = [];
      this.bus.emit('village:destroyed', { villageId: v.id });
    }

    const player = state.villages[PLAYER_ID];
    if (!player.alive) {
      this.end(state, 'lost');
      return;
    }

    const rivals = Object.values(state.villages).filter((v) => v.alive && v.id !== PLAYER_ID);
    if (rivals.some((v) => !player.allies.includes(v.id) && !v.allies.includes(player.id))) return;
    if (rivals.length === 0) {
      this.end(state, 'won');
      return;
    }
    // Only allies remain: every alliance breaks.
    for (const v of [player, ...rivals]) v.allies = [];
    this.bus.emit('notify', { message: 'Il ne peut en rester qu’un ! Vos alliances sont rompues' });
  }

  private end(state: GameState, status: 'won' | 'lost'): void {
    state.status = status;
    this.bus.emit('game:over', { status });
  }
}
