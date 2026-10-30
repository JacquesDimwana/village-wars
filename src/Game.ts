import * as THREE from 'three';
import { BUILDINGS, GAME } from './core/config';
import { PLAYER_ID } from './core/constants';
import { bus } from './core/EventBus';
import { addBuilding, createGameState, townHallOf } from './core/GameState';
import type { GameState } from './core/types';
import { RtsCamera } from './input/RtsCamera';
import { Assets } from './render/Assets';
import { EntityRenderer } from './render/EntityRenderer';
import { Terrain } from './render/Terrain';
import { ArmorySystem } from './systems/ArmorySystem';
import { EconomySystem } from './systems/EconomySystem';
import { PopulationSystem, convertToWarrior } from './systems/PopulationSystem';
import { Hud } from './ui/Hud';
import { WorldGen } from './world/WorldGen';

/** Fixed logic tick so game rules don't depend on frame rate. */
const TICK_MS = 100;
const SKY = 0x9fd4f0;

export class Game {
  readonly world = new WorldGen(GAME.seed);
  readonly state: GameState = createGameState(this.world);
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RtsCamera;
  readonly entities: EntityRenderer;
  readonly terrain: Terrain;
  private hud: Hud;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private accumulator = 0;

  private population = new PopulationSystem(bus);
  private economy = new EconomySystem(bus);
  private armory = new ArmorySystem(bus);

  constructor(
    container: HTMLElement,
    assets: Assets,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 35, 75);

    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x5b6b3a, 1.6));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -28;
    s.right = 28;
    s.top = 28;
    s.bottom = -28;
    s.near = 1;
    s.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.cam = new RtsCamera(this.renderer.domElement, GAME.camera);
    this.terrain = new Terrain(this.world, assets, GAME.chunkSize);
    this.entities = new EntityRenderer(assets);
    this.scene.add(this.terrain.root, this.entities.root);

    const hall = townHallOf(this.state, PLAYER_ID);
    if (hall) {
      const half = BUILDINGS.townHall.size / 2;
      this.cam.lookAt(hall.tx + half, hall.ty + half + 1);
    }
    this.cam.onTap = (ndc) => this.handleTap(ndc);

    this.hud = new Hud(document.body, () => this.state, bus);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.25);
    this.accumulator += dt * 1000;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.tick(TICK_MS);
    }

    const t = this.cam.target;
    this.terrain.update(t, this.cam.viewRadius);
    this.sun.position.set(t.x - 18, 30, t.z + 10);
    this.sun.target.position.copy(t);
    this.entities.sync(this.state, dt);
    this.hud.update();
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** One logic step. Register new systems here (order matters). */
  private tick(dt: number): void {
    if (this.state.status !== 'playing') return;
    this.state.timeMs += dt;
    this.population.update(this.state, dt);
    this.economy.update(this.state, dt);
    this.armory.update(this.state, dt);
    // TODO(agent A) construction.update(this.state, dt)
    // TODO(agent B) movement
    // TODO(agent C) combat
    // TODO(agent D) ai
    // TODO(agent E) diplomacy / fog
  }

  /**
   * Debug only (console: __vw.debugDemo()): fills the player's village with a few
   * buildings and warriors to preview models and animations.
   */
  debugDemo(): void {
    const hall = townHallOf(this.state, PLAYER_ID);
    if (!hall) return;
    const { tx, ty } = hall;
    const place: [Parameters<typeof addBuilding>[1], number, number, boolean][] = [
      ['barracks', tx + 5, ty - 1, true],
      ['house', tx - 3, ty, true],
      ['house', tx - 3, ty + 3, true],
      ['armory', tx + 1, ty + 5, true],
      ['lumberCamp', tx - 3, ty - 3, true],
      ['tower', tx + 4, ty + 4, true],
      ['smelter', tx + 6, ty + 3, false],
    ];
    for (const [type, x, y, done] of place) {
      const b = addBuilding(this.state, type, PLAYER_ID, x, y, done);
      if (!done) b.buildProgress = 0.4;
    }
    const v = this.state.villages[PLAYER_ID];
    v.inhabitants = 12;
    v.weapons = { sword: 4, bow: 3 };
    for (let i = 0; i < 4; i++) convertToWarrior(this.state, PLAYER_ID, 'knight', bus);
    for (let i = 0; i < 3; i++) convertToWarrior(this.state, PLAYER_ID, 'archer', bus);
    // Spread them out a bit in front of the barracks.
    Object.values(this.state.units).forEach((u, i) => {
      u.x += (i % 4) * 0.9 - 1.5;
      u.y += Math.floor(i / 4) * 0.9 + 0.3;
    });
  }

  private handleTap(ndc: THREE.Vector2): void {
    const hit = this.cam.raycast(ndc, this.entities.buildingObjects)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.buildingId) o = o.parent;
      const b = o ? this.state.buildings[o.userData.buildingId as string] : undefined;
      if (b) {
        const owner = this.state.villages[b.ownerId];
        bus.emit('notify', { message: `${BUILDINGS[b.type].name} — ${owner.name}` });
        return;
      }
    }
    const p = this.cam.groundPoint(ndc);
    if (p) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      bus.emit('tile:tapped', { tx, ty, tile: this.world.getTile(tx, ty) });
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cam.resize(w, h);
  }
}
