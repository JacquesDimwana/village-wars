import type { BuildingType, Resources, WeaponType } from './types';

/** All game events and their payloads. Add new events here so they stay typed. */
export interface GameEvents {
  'resources:changed': { villageId: string; resources: Resources };
  'population:changed': { villageId: string };
  'weapons:changed': { villageId: string; weapons: Record<WeaponType, number> };
  'building:placed': { buildingId: string; type: BuildingType; villageId: string };
  'building:completed': { buildingId: string };
  'building:destroyed': { buildingId: string };
  'village:destroyed': { villageId: string };
  'game:over': { status: 'won' | 'lost' };
  notify: { message: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<unknown>);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Shared instance used by scenes and systems. Tests can create their own EventBus. */
export const bus = new EventBus();
