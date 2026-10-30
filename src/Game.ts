import * as THREE from 'three';
import { BUILDINGS, GAME, UNITS, WEAPONS } from './core/config';
import { PLAYER_ID } from './core/constants';
import { bus } from './core/EventBus';
import { addBuilding, createGameState, townHallOf } from './core/GameState';
import type { BuildingType, GameState, UnitType, WeaponType } from './core/types';
import { RtsCamera } from './input/RtsCamera';
import { Assets } from './render/Assets';
import { EntityRenderer } from './render/EntityRenderer';
import { PlacementGhost } from './render/PlacementGhost';
import { Terrain } from './render/Terrain';
import { ArmorySystem, queueWeapon } from './systems/ArmorySystem';
import { ConstructionSystem, canPlace, placeBuilding, upgradeBuilding } from './systems/ConstructionSystem';
import { EconomySystem } from './systems/EconomySystem';
import { FogSystem } from './systems/FogSystem';
import { PopulationSystem, convertToWarrior, demobilize } from './systems/PopulationSystem';
import { Hud, type HudActions } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { PlacementBar } from './ui/PlacementBar';
import { WorldGen } from './world/WorldGen';

/** Fixed logic tick so game rules don't depend on frame rate. */
const TICK_MS = 100;
const SKY = 0x9fd4f0;
/** Distance fog and shadow area follow the zoom (values tuned at distance 20). */
const FOG_NEAR_OFFSET = 15;
const FOG_FAR_OFFSET = 55;
const SHADOW_EXTENT_PER_DISTANCE = 1.4;

export class Game {
  readonly world = new WorldGen(GAME.seed);
  readonly state: GameState = createGameState(this.world);
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RtsCamera;
  readonly entities: EntityRenderer;
  readonly terrain: Terrain;
  private hud: Hud;
  private minimap: Minimap;
  private placement: PlacementGhost;
  private placementBar: PlacementBar;
  private shadowDistance = 0;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private accumulator = 0;

  private population = new PopulationSystem(bus);
  private economy = new EconomySystem(bus);
  private armory = new ArmorySystem(bus);
  private fog = new FogSystem();
  private construction = new ConstructionSystem(bus);

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
    this.placement = new PlacementGhost(assets, this.cam, this.renderer.domElement, (type, tx, ty) =>
      canPlace(this.state, this.world, type, tx, ty, PLAYER_ID),
    );
    this.placementBar = new PlacementBar(() => this.confirmPlacement(), () => this.stopPlacement());
    this.scene.add(this.terrain.root, this.entities.root, this.placement.root);

    const hall = townHallOf(this.state, PLAYER_ID);
    const half = BUILDINGS.townHall.size / 2;
    const home = hall ? { x: hall.tx + half, y: hall.ty + half } : { x: 0, y: 0 };
    this.cam.lookAt(home.x, home.y + 1);
    this.cam.onTap = (ndc) => this.handleTap(ndc);

    this.hud = new Hud(document.body, () => this.state, bus, this.hudActions(home));
    this.minimap = new Minimap(
      document.body,
      home,
      () => this.state,
      (tx, ty) => this.world.getTile(tx, ty),
      () => ({ x: this.cam.target.x, y: this.cam.target.z, radius: this.cam.distance * 0.6 }),
      (x, y) => this.cam.lookAt(x, y),
    );
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
    this.followZoom();
    this.entities.sync(this.state, dt);
    this.updatePlacement();
    this.hud.update();
    this.minimap.update(performance.now());
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** One logic step. Register new systems here (order matters). */
  private tick(dt: number): void {
    if (this.state.status !== 'playing') return;
    this.state.timeMs += dt;
    this.population.update(this.state, dt);
    this.economy.update(this.state, dt);
    this.armory.update(this.state, dt);
    this.fog.update(this.state, dt);
    this.construction.update(this.state, dt);
    // TODO(agent B) movement
    // TODO(agent C) combat
    // TODO(agent D) ai
    // TODO(agent E) diplomacy / fog of war on the 3D terrain (exploration data: state.fog)
  }

  /** Keeps distance fog and the shadow area proportional to the zoom so dezooming stays readable. */
  private followZoom(): void {
    const d = this.cam.distance;
    if (d === this.shadowDistance) return;
    this.shadowDistance = d;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d + FOG_NEAR_OFFSET;
    fog.far = d + FOG_FAR_OFFSET;
    const e = d * SHADOW_EXTENT_PER_DISTANCE;
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -e;
    s.right = s.top = e;
    s.updateProjectionMatrix();
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
  }

  /** What the player can do from the HUD. Rules stay in the systems. */
  private hudActions(home: { x: number; y: number }): HudActions {
    const notify = (message: string): void => bus.emit('notify', { message });
    return {
      forge: (weapon: WeaponType) => {
        if (queueWeapon(this.state, PLAYER_ID, weapon)) notify(`${WEAPONS[weapon].name} : en cours de forge`);
        else notify('Impossible de forger : armurerie ou ressources manquantes');
      },
      train: (unit: UnitType) => {
        const messages = {
          ok: `${UNITS[unit].name.replace(/ \(.*\)/, '')} formé !`,
          'no-barracks': 'Construis d’abord une caserne',
          'no-civilian': 'Aucun habitant disponible',
          'no-weapon': `Pas de ${WEAPONS[UNITS[unit].weapon].name.toLowerCase()} en stock`,
        };
        notify(messages[convertToWarrior(this.state, PLAYER_ID, unit, bus)]);
      },
      demobilize: (unit: UnitType) => {
        const last = Object.values(this.state.units).filter((u) => u.ownerId === PLAYER_ID && u.type === unit).pop();
        if (last && demobilize(this.state, last.id, bus)) notify('Le guerrier retourne au travail');
      },
      build: (type) => this.startPlacement(type),
      upgrade: (buildingId) => {
        const res = upgradeBuilding(this.state, buildingId, bus);
        notify(res.ok ? `${BUILDINGS[this.state.buildings[buildingId].type].name} amélioré !` : res.reason);
      },
      focus: (x, y) => this.cam.lookAt(x, y + 1),
      home: () => this.cam.lookAt(home.x, home.y + 1),
    };
  }

  /** Placement mode: the build panel closes and a ghost of the building follows the player's finger. */
  private startPlacement(type: BuildingType): void {
    this.hud.openSheet(null);
    bus.emit('building:selected', { buildingId: null });
    this.placement.start(type, this.cam.target.x, this.cam.target.z);
    this.placementBar.show(type);
  }

  private stopPlacement(): void {
    this.placement.stop();
    this.placementBar.hide();
  }

  private confirmPlacement(): void {
    const { type, tx, ty } = this.placement;
    if (!type) return;
    const res = placeBuilding(this.state, this.world, type, tx, ty, PLAYER_ID, bus);
    if (!res.ok) return bus.emit('notify', { message: res.reason });
    bus.emit('notify', { message: `${BUILDINGS[type].name} : construction lancée` });
    this.stopPlacement();
  }

  private updatePlacement(): void {
    const res = this.placement.update();
    if (res && this.placement.type) {
      this.placementBar.update(this.placement.type, this.state.villages[PLAYER_ID], res.ok ? null : res.reason);
    }
  }

  private handleTap(ndc: THREE.Vector2): void {
    if (this.placement.active) return this.placement.tapAt(ndc);
    const hit = this.cam.raycast(ndc, this.entities.buildingObjects)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.buildingId) o = o.parent;
      const b = o ? this.state.buildings[o.userData.buildingId as string] : undefined;
      if (b) {
        bus.emit('building:selected', { buildingId: b.id });
        return;
      }
    }
    const p = this.cam.groundPoint(ndc);
    if (p) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      bus.emit('building:selected', { buildingId: null });
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
