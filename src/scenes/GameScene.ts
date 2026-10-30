import Phaser from 'phaser';
import { GAME } from '../core/config';
import { PLAYER_ID, TILE_SIZE } from '../core/constants';
import { bus } from '../core/EventBus';
import { createGameState, townHallOf } from '../core/GameState';
import type { GameState } from '../core/types';
import { BuildingView } from '../entities/BuildingView';
import { UnitView } from '../entities/UnitView';
import { CameraController } from '../input/CameraController';
import { ArmorySystem } from '../systems/ArmorySystem';
import { EconomySystem } from '../systems/EconomySystem';
import { PopulationSystem } from '../systems/PopulationSystem';
import { ChunkManager } from '../world/ChunkManager';
import { WorldGen } from '../world/WorldGen';

/** Fixed logic tick so game rules don't depend on frame rate. */
const TICK_MS = 100;

export class GameScene extends Phaser.Scene {
  state!: GameState;
  world!: WorldGen;
  cameraController!: CameraController;
  private chunks!: ChunkManager;
  private population = new PopulationSystem(bus);
  private economy = new EconomySystem(bus);
  private armory = new ArmorySystem(bus);
  private buildingViews = new Map<string, BuildingView>();
  private unitViews = new Map<string, UnitView>();
  private accumulator = 0;

  constructor() {
    super('Game');
  }

  create(): void {
    this.world = new WorldGen(GAME.seed);
    this.state = createGameState(this.world);
    this.chunks = new ChunkManager(this, this.world, GAME.chunkSize, GAME.chunkLoadRadius);
    this.cameraController = new CameraController(this, GAME.camera);

    const hall = townHallOf(this.state, PLAYER_ID);
    if (hall) {
      const c = ((hall.tx + 1.5) * TILE_SIZE) | 0;
      const r = ((hall.ty + 1.5) * TILE_SIZE) | 0;
      this.cameras.main.centerOn(c, r);
    }
    this.cameras.main.setZoom(GAME.camera.initialZoom).setBackgroundColor('#1b2a1b');

    this.syncViews();
    bus.emit('resources:changed', {
      villageId: PLAYER_ID,
      resources: { ...this.state.villages[PLAYER_ID].resources },
    });

    // Debug handle for the browser console and automated tests.
    (window as unknown as { __vw: GameScene }).__vw = this;
  }

  update(_time: number, delta: number): void {
    this.chunks.update(this.cameras.main);

    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.tick(TICK_MS);
    }
    this.syncViews();
  }

  /** One logic step. Register new systems here (order matters). */
  private tick(dt: number): void {
    if (this.state.status !== 'playing') return;
    this.state.timeMs += dt;
    this.population.update(this.state, dt);
    this.economy.update(this.state, dt);
    this.armory.update(this.state, dt);
    // TODO(agent A) construction.update(this.state, dt)
    // TODO(agent B) movement + barracks conversion UI
    // TODO(agent C) combat
    // TODO(agent D) ai
    // TODO(agent E) diplomacy / fog
  }

  /** Create, update and destroy views so they mirror GameState. */
  private syncViews(): void {
    for (const b of Object.values(this.state.buildings)) {
      let view = this.buildingViews.get(b.id);
      if (!view) {
        view = new BuildingView(this, b, this.state.villages[b.ownerId]);
        this.buildingViews.set(b.id, view);
      }
      view.sync(b);
    }
    for (const [id, view] of this.buildingViews) {
      if (!this.state.buildings[id]) {
        view.destroy();
        this.buildingViews.delete(id);
      }
    }
    for (const u of Object.values(this.state.units)) {
      let view = this.unitViews.get(u.id);
      if (!view) {
        view = new UnitView(this, u, this.state.villages[u.ownerId]);
        this.unitViews.set(u.id, view);
      }
      view.sync(u);
    }
    for (const [id, view] of this.unitViews) {
      if (!this.state.units[id]) {
        view.destroy();
        this.unitViews.delete(id);
      }
    }
  }

  get loadedChunks(): number {
    return this.chunks.loadedCount;
  }
}
