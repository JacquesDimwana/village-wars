import * as THREE from 'three';
import { BUILDINGS, GAME, UNITS, WEAPONS } from './core/config';
import { PLAYER_ID } from './core/constants';
import { bus } from './core/EventBus';
import { addBuilding, createGameState, townHallOf } from './core/GameState';
import type { Building, GameState, UnitType, WeaponType } from './core/types';
import { RtsCamera } from './input/RtsCamera';
import { UnitControl } from './input/UnitControl';
import { Assets } from './render/Assets';
import { CrowdRenderer } from './render/CrowdRenderer';
import { EntityRenderer } from './render/EntityRenderer';
import { Terrain, type ViewBounds } from './render/Terrain';
import { ArmorySystem, queueWeapon } from './systems/ArmorySystem';
import { EconomySystem } from './systems/EconomySystem';
import { FogSystem } from './systems/FogSystem';
import { ArmySystem } from './systems/ArmySystem';
import { GatherSystem } from './systems/GatherSystem';
import { MovementSystem } from './systems/MovementSystem';
import { PopulationSystem, convertToWarrior, demobilize } from './systems/PopulationSystem';
import { VillagerSystem } from './systems/VillagerSystem';
import { Hud, type HudActions } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { WorldGen } from './world/WorldGen';

/** Fixed logic tick so game rules don't depend on frame rate. */
const TICK_MS = 100;
const SKY = 0xbac6c3;
/** Shadow area follows the zoom. */
const SHADOW_EXTENT_PER_DISTANCE = 1.4;
/** Extra ground loaded around the visible area (tiles), so panning doesn't show holes. */
const VIEW_MARGIN = 6;

export class Game {
  readonly world = new WorldGen(GAME.seed);
  readonly state: GameState = createGameState(this.world);
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RtsCamera;
  readonly entities: EntityRenderer;
  /** Soldiers + villagers (instanced, vertex-animated). */
  readonly crowd: CrowdRenderer;
  readonly terrain: Terrain;
  /** Ids of the selected soldiers / villagers (owned by UnitControl). */
  readonly selectedIds = new Set<string>();
  unitControl!: UnitControl;
  private hud: Hud;
  private minimap: Minimap;
  private shadowDistance = 0;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private accumulator = 0;
  private ndc = new THREE.Vector2();

  private population = new PopulationSystem(bus);
  private economy = new EconomySystem(bus);
  private armory = new ArmorySystem(bus);
  private fog = new FogSystem();
  readonly movement = new MovementSystem((tx, ty) => this.world.getTile(tx, ty));
  private villagers = new VillagerSystem(this.movement);
  private gather = new GatherSystem(this.movement, bus);
  private army = new ArmySystem(this.movement);

  constructor(
    container: HTMLElement,
    assets: Assets,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 55, 110);

    this.scene.add(new THREE.HemisphereLight(0xc5d7e4, 0x807966, 1.0));
    this.sun = new THREE.DirectionalLight(0xfff1d9, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
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
    this.crowd = new CrowdRenderer(assets, (tx, ty) => this.world.getTile(tx, ty));
    this.scene.add(this.terrain.root, this.entities.root, this.crowd.root);

    const hall = townHallOf(this.state, PLAYER_ID);
    const half = BUILDINGS.townHall.size / 2;
    const home = hall ? { x: hall.tx + half, y: hall.ty + half } : { x: 0, y: 0 };
    this.cam.lookAt(home.x, home.y + 1);
    this.cam.onTap = (ndc, shift, mouse) => this.handleTap(ndc, shift, mouse);

    this.hud = new Hud(document.body, () => this.state, bus, this.hudActions(home));
    this.unitControl = new UnitControl({
      parent: this.hud.root,
      canvas: this.renderer.domElement,
      cam: this.cam,
      bus,
      movement: this.movement,
      getState: () => this.state,
      selection: this.hud.selection,
      selectedIds: this.selectedIds,
      hud: this.hud,
      home: () => this.cam.lookAt(home.x, home.y + 1),
      buildingAt: (ndc) => this.buildingAt(ndc),
    });
    this.unitControl.onMarker = (tiles, kind) => this.crowd.showMarker(tiles, kind === 'assign' ? 'move' : kind);
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
    this.terrain.update(t, this.cam.viewRadius, this.cam.camera.position, this.viewBounds());
    this.sun.position.set(t.x + 40, 65, t.z + 30);
    this.sun.target.position.copy(t);
    this.followZoom();
    this.entities.sync(this.state);
    this.crowd.sync(this.state, dt, this.selectedIds, this.cam.distance);
    this.hud.update();
    this.unitControl.update();
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
    this.villagers.update(this.state, dt);
    this.gather.update(this.state, dt);
    this.army.update(this.state, dt);
    this.movement.update(this.state, dt);
    this.fog.update(this.state, dt);
    // TODO(agent A) construction.update(this.state, dt)
    // TODO(agent C) combat
    // TODO(agent D) ai
    // TODO(agent E) diplomacy / fog of war on the 3D terrain (exploration data: state.fog)
  }

  /**
   * Ground area seen by the camera (screen corners projected on y=0) plus a margin,
   * so the terrain only loads the chunks on screen. Undefined if a corner sees the sky.
   */
  private viewBounds(): ViewBounds | undefined {
    const b: ViewBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = this.cam.groundPoint(this.ndc.set(x, y));
      if (!p) return undefined;
      b.minX = Math.min(b.minX, p.x - VIEW_MARGIN);
      b.maxX = Math.max(b.maxX, p.x + VIEW_MARGIN);
      b.minZ = Math.min(b.minZ, p.z - VIEW_MARGIN);
      b.maxZ = Math.max(b.maxZ, p.z + VIEW_MARGIN);
    }
    return b;
  }

  /** Keeps the shadow area proportional to the zoom. */
  private followZoom(): void {
    const d = this.cam.distance;
    if (d === this.shadowDistance) return;
    this.shadowDistance = d;
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
      build: (type) => notify(`${BUILDINGS[type].name} : placement sur la carte bientôt disponible`),
      focus: (x, y) => this.cam.lookAt(x, y + 1),
      home: () => this.cam.lookAt(home.x, home.y + 1),
    };
  }

  /** Player-visible building under a screen point (raycast on the building models). */
  private buildingAt(ndc: THREE.Vector2): Building | undefined {
    const hit = this.cam.raycast(ndc, this.entities.buildingObjects)[0];
    if (!hit) return undefined;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.buildingId) o = o.parent;
    return o ? this.state.buildings[o.userData.buildingId as string] : undefined;
  }

  private handleTap(ndc: THREE.Vector2, shift = false, mouse = false): void {
    const b = this.buildingAt(ndc);
    if (this.unitControl.handleTap(ndc, b, mouse, shift)) return;
    if (b) {
      bus.emit('building:selected', { buildingId: b.id });
      return;
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
