import { FogMask } from './render/FogOfWar';
import { DiplomacySystem } from './systems/DiplomacySystem';
import { FoodSources } from './render/FoodSources';
import * as THREE from 'three';
import { BUILDINGS, GAME } from './core/config';
import { PLAYER_ID } from './core/constants';
import { bus } from './core/EventBus';
import { addBuilding, addUnit, createGameState, townHallOf } from './core/GameState';
import type { Building, BuildingType, GameState } from './core/types';
import { RtsCamera } from './input/RtsCamera';
import { UnitControl } from './input/UnitControl';
import { Assets } from './render/Assets';
import { CrowdRenderer } from './render/CrowdRenderer';
import { EntityRenderer } from './render/EntityRenderer';
import { PlacementGhost } from './render/PlacementGhost';
import { Terrain, type ViewBounds } from './render/Terrain';
import { ProgressionSystem, queueAge, queueResearch, cancelResearch } from './systems/ProgressionSystem';
import { TrainingSystem, queueTraining, cancelTraining } from './systems/TrainingSystem';
import { ConstructionSystem, canPlace, placeBuilding, upgradeBuilding, orderBuildingWork, cancelConstruction } from './systems/ConstructionSystem';
import { FogSystem } from './systems/FogSystem';
import { AISystem } from './systems/AISystem';
import { ArmySystem } from './systems/ArmySystem';
import { CombatSystem } from './systems/CombatSystem';
import { GatherSystem } from './systems/GatherSystem';
import { MovementSystem } from './systems/MovementSystem';
import { VillagerSystem, listIdleVillagers } from './systems/VillagerSystem';

import { StatsSystem } from './systems/StatsSystem';
import { VictorySystem } from './systems/VictorySystem';
import { Hud, type HudActions } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { PlacementBar } from './ui/PlacementBar';
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
  readonly state: GameState;
  /** Logic speed multiplier (pause menu: ×1 / ×2). */
  speed = 1;
  paused = false;
  readonly renderer: THREE.WebGLRenderer;
  private foodSources = new FoodSources();
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
  private placement: PlacementGhost;
  private placementBar: PlacementBar;
  private shadowDistance = 0;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private accumulator = 0;
  private ndc = new THREE.Vector2();

  private fog = new FogSystem();
  private fogMask = new FogMask();
  private diplomacy = new DiplomacySystem(bus);
  readonly movement = new MovementSystem((tx, ty) => this.world.getTile(tx, ty));
  private ai = new AISystem(this.world, this.movement);
  private rallyBuildingId: string | null = null;
  private idleIndex = 0;
  private training = new TrainingSystem(this.movement, bus);
  private progression = new ProgressionSystem(bus);
  private villagers = new VillagerSystem(this.movement);
  private gather = new GatherSystem(this.movement, bus);
  private army = new ArmySystem(this.movement);
  private combat = new CombatSystem(this.movement, bus);
  private construction = new ConstructionSystem(bus, this.movement);

  private victory = new VictorySystem(bus);
  private stats = new StatsSystem(bus);

  constructor(
    container: HTMLElement,
    assets: Assets,
    /** Saved game to resume; a new game is created when absent. */
    saved?: GameState | null,
  ) {
    this.state = saved ?? createGameState(this.world);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 55, 110);

    this.scene.add(new THREE.HemisphereLight(0xc5d7e4, 0x9a927c, 1.25));
    this.sun = new THREE.DirectionalLight(0xfff1d9, 2.2);
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

    const mapHalf = GAME.map.halfSize;
    this.cam = new RtsCamera(this.renderer.domElement, {
      ...GAME.camera, bounds: { minX: -mapHalf, maxX: mapHalf, minZ: -mapHalf, maxZ: mapHalf },
    });
    this.terrain = new Terrain(this.world, assets, GAME.chunkSize);
    this.entities = new EntityRenderer(assets);
    this.crowd = new CrowdRenderer(assets, (tx, ty) => this.world.getTile(tx, ty));
    this.placement = new PlacementGhost(assets, this.cam, this.renderer.domElement, (type, tx, ty) =>
      canPlace(this.state, this.world, type, tx, ty, PLAYER_ID),
    );
    this.placementBar = new PlacementBar(() => this.confirmPlacement(), () => this.stopPlacement());
    this.scene.add(this.foodSources.root, this.terrain.root, this.entities.root, this.crowd.root, this.placement.root);

    const hall = townHallOf(this.state, PLAYER_ID);
    const half = BUILDINGS.townHall.size / 2;
    const home = hall ? { x: hall.tx + half, y: hall.ty + half } : { x: 0, y: 0 };
    bus.on('diplomacy:reinforcements', ({ unitIds, target }) => {
      for (const id of unitIds) {
        const u = this.state.units[id];
        if (u) { u.onMission = true; u.departMs = 0; this.movement.moveTo(this.state, u, Math.floor(target.x), Math.floor(target.y)); }
      }
    });
    bus.on('diplomacy:lastStanding', () => bus.emit('notify', { message: 'Il ne peut en rester qu’un ! Vos alliances sont rompues' }));
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
    if (!this.paused) this.accumulator += dt * 1000 * this.speed;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.tick(TICK_MS);
    }

    const t = this.cam.target;
    this.terrain.update(t, this.cam.viewRadius, this.cam.camera.position, this.viewBounds(), this.cam.distance);
    this.sun.position.set(t.x + 40, 65, t.z + 30);
    this.sun.target.position.copy(t);
    this.followZoom();
    this.foodSources.sync(this.state);
    this.fogMask.update(this.state.fog);
    this.entities.sync(this.state);
    this.crowd.sync(this.state, dt, this.selectedIds, this.cam.distance);
    this.updatePlacement();
    this.hud.update();
    this.unitControl.update();
    this.minimap.update(performance.now());
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** One logic step. Register new systems here (order matters). */
  private tick(dt: number): void {
    if (this.state.status !== 'playing') return;
    this.state.timeMs += dt;
    this.training.update(this.state, dt);
    this.progression.update(this.state, dt);
    this.construction.update(this.state, dt);
    this.villagers.update(this.state, dt);
    this.gather.update(this.state, dt);
    this.army.update(this.state, dt);
    this.movement.update(this.state, dt);
    this.combat.update(this.state, dt);
    this.fog.update(this.state, dt);
    this.ai.update(this.state, dt);
    this.diplomacy.update(this.state, dt);
    this.victory.update(this.state);
    this.stats.update(this.state);
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
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d + 15;
    fog.far = d + 55;
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
    ];
    for (const [type, x, y, done] of place) {
      const b = addBuilding(this.state, type, PLAYER_ID, x, y, done);
      if (!done) b.buildProgress = 0.4;
    }
    for (let i = 0; i < 4; i++) addUnit(this.state, 'knight', PLAYER_ID, tx + 5 + i, ty + 3);
    for (let i = 0; i < 3; i++) addUnit(this.state, 'archer', PLAYER_ID, tx + 5 + i, ty + 4);
  }

  /** What the player can do from the HUD. Rules stay in the systems. */
  private hudActions(home: { x: number; y: number }): HudActions {
    const notify = (message: string): void => bus.emit('notify', { message });
    return {
      train: (buildingId, type) => {
        notify(queueTraining(this.state, buildingId, type) ? 'Formation ajoutée à la file' : 'Formation impossible : ressources ou places insuffisantes');
      },
      age: (id) => { queueAge(this.state, id); },
      research: (id, type) => { queueResearch(this.state, id, type); },
      cancelResearch: (id, index) => { cancelResearch(this.state, id, index); },
      rally: (buildingId) => { this.rallyBuildingId = buildingId; this.hud.openSheet(null); notify('Touchez le sol pour fixer le ralliement'); },
      idle: () => { const idle = listIdleVillagers(this.state, PLAYER_ID); if (!idle.length) return; const v = idle[this.idleIndex++ % idle.length]; this.unitControl.selectVillager(v.id); this.cam.lookAt(v.x, v.y); },
      cancel: (buildingId, index) => { cancelTraining(this.state, buildingId, index); },
      build: (type) => this.startPlacement(type),
      cancelConstruction: (buildingId) => { cancelConstruction(this.state, buildingId, bus); },
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
    orderBuildingWork(this.state, this.movement, [...this.selectedIds].map(id => this.state.villagers[id]).filter(v => v !== undefined), res.building);
    bus.emit('notify', { message: `${BUILDINGS[type].name} : construction lancée` });
    this.stopPlacement();
  }

  private updatePlacement(): void {
    const res = this.placement.update();
    if (res && this.placement.type) {
      this.placementBar.update(this.placement.type, this.state.villages[PLAYER_ID], res.ok ? null : res.reason);
    }
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
    if (this.placement.active) return this.placement.tapAt(ndc);
    if (this.rallyBuildingId) {
      const p = this.cam.groundPoint(ndc);
      if (p) { const x = Math.floor(p.x), y = Math.floor(p.z); const b = this.state.buildings[this.rallyBuildingId]; if (b && this.movement.walkable(this.state, x, y)) { b.rallyPoint = { tx: x, ty: y }; this.rallyBuildingId = null; bus.emit('notify', { message: 'Point de ralliement défini' }); } else bus.emit('notify', { message: 'Point de ralliement inaccessible' }); }
      return;
    }
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
