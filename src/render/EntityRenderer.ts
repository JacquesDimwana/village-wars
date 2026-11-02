import * as THREE from 'three';
import { BUILDINGS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { Building, Convoy, GameState, Unit } from '../core/types';
import { isVisible } from '../systems/FogSystem';
import type { Assets } from './Assets';
import { withFog } from './FogOfWar';
import { teamStyle } from './teams';

interface BuildingView {
  root: THREE.Group;
  model: THREE.Object3D;
  completed: boolean;
  hpGroup: THREE.Group;
  hpFill: THREE.Mesh;
  /** Enemy building seen at least once: shown frozen at its last seen state when out of vision. */
  seen: boolean;
  /** Center tile, for vision checks (also after the building is gone from the state). */
  cx: number;
  cy: number;
}

interface UnitView {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current?: THREE.AnimationAction;
  last: THREE.Vector2;
}

/** Convoy smoothing: fraction of the remaining distance covered per second (logic ticks at 10 Hz). */
const CONVOY_FOLLOW = 10;

/** Animation clip names per state (KayKit Adventurers rig). */
const ANIM = {
  knight: { idle: 'Idle', walk: 'Walking_A', attack: '1H_Melee_Attack_Chop' },
  archer: { idle: '2H_Ranged_Aiming', walk: 'Walking_B', attack: '2H_Ranged_Shoot' },
} as const;

/**
 * Mirrors GameState buildings/units into the 3D scene.
 * No game rules here: it only reads state.
 */
export class EntityRenderer {
  readonly root = new THREE.Group();
  private buildings = new Map<string, BuildingView>();
  private units = new Map<string, UnitView>();
  private convoys = new Map<string, THREE.Group>();
  private ringGeo = new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2);
  private barGeo = new THREE.PlaneGeometry(1, 0.08);
  /** Same plane with its origin on the left edge, so scaling x shrinks it from the right. */
  private fillGeo = new THREE.PlaneGeometry(1, 0.08).translate(0.5, 0, 0);

  constructor(private assets: Assets) {}

  sync(state: GameState, dtSec: number): void {
    this.syncBuildings(state);
    this.syncUnits(state, dtSec);
    this.syncConvoys(state, dtSec);
  }

  /** Building root objects currently shown, for tap raycasting. userData.buildingId is set on each. */
  get buildingObjects(): THREE.Object3D[] {
    return [...this.buildings.values()].filter((v) => v.root.visible).map((v) => v.root);
  }

  private syncBuildings(state: GameState): void {
    const fog = state.fog;
    for (const b of Object.values(state.buildings)) {
      let view = this.buildings.get(b.id);
      const completed = b.buildProgress >= 1;
      if (!view) {
        view = this.createBuilding(b, completed);
        this.buildings.set(b.id, view);
        this.root.add(view.root);
      }
      // Fog of war: enemy buildings appear once seen, then stay frozen while out of vision.
      if (b.ownerId !== PLAYER_ID && !isVisible(fog, view.cx, view.cy)) {
        view.root.visible = view.seen;
        continue;
      }
      view.seen = true;
      view.root.visible = true;
      if (view.completed !== completed) {
        view.root.remove(view.model);
        view.model = this.buildingModel(b, completed);
        view.root.add(view.model);
        view.completed = completed;
      }
      const ratio = !completed ? b.buildProgress : Math.max(0, b.hp / b.maxHp);
      view.hpFill.scale.x = Math.max(0.001, ratio);
      (view.hpFill.material as THREE.MeshBasicMaterial).color.setHex(completed ? 0x2ecc71 : 0xf1c40f);
      view.hpGroup.visible = ratio < 1;
    }
    for (const [id, view] of this.buildings) {
      if (state.buildings[id]) continue;
      // A destroyed enemy building stays as last seen until the player sees the spot again.
      if (view.seen && view.root.userData.ownerId !== PLAYER_ID && !isVisible(fog, view.cx, view.cy)) continue;
      this.root.remove(view.root);
      this.buildings.delete(id);
    }
  }

  private createBuilding(b: Building, completed: boolean): BuildingView {
    const size = BUILDINGS[b.type].size;
    const root = new THREE.Group();
    root.position.set(b.tx + size / 2, 0, b.ty + size / 2);
    root.userData.buildingId = b.id;
    root.userData.ownerId = b.ownerId;
    const model = this.buildingModel(b, completed);
    root.add(model);

    const style = teamStyle(b.ownerId);
    if (b.type === 'townHall') {
      const flag = withFog(this.assets.flag(style.kaykit, style.tint));
      flag.position.set(size * 0.42, 0, size * 0.42);
      root.add(flag);
    }

    // Bar shown when damaged (green) or under construction (yellow). Faces the camera yaw.
    const barWidth = Math.min(size, 2);
    const hpGroup = new THREE.Group();
    hpGroup.position.y = size * 0.9 + 0.4;
    hpGroup.rotation.y = Math.PI / 4;
    hpGroup.scale.x = barWidth;
    const bg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }));
    const hpFill = new THREE.Mesh(this.fillGeo, new THREE.MeshBasicMaterial({ color: 0x2ecc71, depthTest: false }));
    hpFill.position.set(-0.5, 0, 0.001);
    bg.renderOrder = 10;
    hpFill.renderOrder = 11;
    hpGroup.add(bg, hpFill);
    root.add(hpGroup);
    const cx = Math.floor(b.tx + size / 2);
    const cy = Math.floor(b.ty + size / 2);
    return { root, model, completed, hpGroup, hpFill, seen: b.ownerId === PLAYER_ID, cx, cy };
  }

  private buildingModel(b: Building, completed: boolean): THREE.Object3D {
    const size = BUILDINGS[b.type].size;
    if (!completed) return withFog(this.assets.neutral('building_scaffolding', size * 0.85));
    const style = teamStyle(b.ownerId);
    const variant = Number(b.id.split('-')[1]) || 0;
    return withFog(this.assets.building(b.type, style.kaykit, variant, size * 0.95, style.tint));
  }

  private syncUnits(state: GameState, dtSec: number): void {
    for (const u of Object.values(state.units)) {
      let view = this.units.get(u.id);
      if (!view) {
        view = this.createUnit(u);
        this.units.set(u.id, view);
        this.root.add(view.root);
      }
      // Fog of war: enemy warriors out of vision are hidden (and not animated).
      view.root.visible = u.ownerId === PLAYER_ID || isVisible(state.fog, Math.floor(u.x + 0.5), Math.floor(u.y + 0.5));
      if (!view.root.visible) {
        view.last.set(u.x, u.y);
        continue;
      }
      const dx = u.x - view.last.x;
      const dz = u.y - view.last.y;
      const moving = Math.hypot(dx, dz) > 0.0005;
      if (moving) view.root.rotation.y = Math.atan2(dx, dz);
      view.root.position.set(u.x + 0.5, 0, u.y + 0.5);
      view.last.set(u.x, u.y);
      this.play(view, moving ? ANIM[u.type].walk : ANIM[u.type].idle);
      view.mixer.update(dtSec);
    }
    for (const [id, view] of this.units) {
      if (state.units[id]) continue;
      this.root.remove(view.root);
      view.mixer.stopAllAction();
      this.units.delete(id);
    }
  }

  private createUnit(u: Unit): UnitView {
    const asset = this.assets.character(u.type);
    const model = this.assets.cloneCharacter(u.type);
    model.scale.setScalar(asset.baseScale * (u.type === 'knight' ? 1.1 : 1));
    const root = new THREE.Group();
    root.add(model);
    root.userData.unitId = u.id;

    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: teamStyle(u.ownerId).marker, transparent: true, opacity: 0.9 }),
    );
    ring.position.y = 0.02;
    root.add(ring);

    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of asset.clips) actions.set(clip.name, mixer.clipAction(clip));
    root.position.set(u.x + 0.5, 0, u.y + 0.5);
    const view: UnitView = { root, mixer, actions, last: new THREE.Vector2(u.x, u.y) };
    this.play(view, ANIM[u.type].idle);
    // Desync idle loops so a group of units doesn't move in lockstep.
    mixer.update(Math.random() * 2);
    return view;
  }

  /** Convoys: a pile of goods with the sender's ring, sliding smoothly towards its logic position. */
  private syncConvoys(state: GameState, dtSec: number): void {
    const k = 1 - Math.exp(-CONVOY_FOLLOW * dtSec);
    for (const c of state.diplomacy.convoys) {
      let view = this.convoys.get(c.id);
      if (!view) {
        view = this.createConvoy(c);
        this.convoys.set(c.id, view);
        this.root.add(view);
      }
      const x = c.x + 0.5;
      const z = c.y + 0.5;
      view.position.x += (x - view.position.x) * k;
      view.position.z += (z - view.position.z) * k;
      view.rotation.y = Math.atan2(c.destX - c.x, c.destY - c.y);
      const mine = c.fromId === PLAYER_ID || c.toId === PLAYER_ID;
      view.visible = mine || isVisible(state.fog, Math.floor(c.x), Math.floor(c.y));
    }
    const alive = new Set(state.diplomacy.convoys.map((c) => c.id));
    for (const [id, view] of this.convoys) {
      if (alive.has(id)) continue;
      this.root.remove(view);
      this.convoys.delete(id);
    }
  }

  private createConvoy(c: Convoy): THREE.Group {
    const root = new THREE.Group();
    const goods = withFog(this.assets.neutral((c.resources.stone ?? 0) > (c.resources.wood ?? 0) ? 'resource_stone' : 'resource_lumber', 0.8));
    root.add(goods);
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: teamStyle(c.fromId).marker, transparent: true, opacity: 0.9 }),
    );
    ring.scale.setScalar(1.8);
    ring.position.y = 0.03;
    root.add(ring);
    root.position.set(c.x + 0.5, 0, c.y + 0.5);
    return root;
  }

  /** Cross-fades to an animation by name (no-op if already playing). */
  play(view: UnitView, name: string): void {
    const next = view.actions.get(name);
    if (!next || next === view.current) return;
    next.reset().fadeIn(0.2).play();
    view.current?.fadeOut(0.2);
    view.current = next;
  }

  /** Plays the attack animation on a unit (used by the combat system later). */
  attack(unitId: string, type: Unit['type']): void {
    const view = this.units.get(unitId);
    if (view) this.play(view, ANIM[type].attack);
  }
}
