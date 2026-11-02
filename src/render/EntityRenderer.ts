import * as THREE from 'three';
import { BUILDINGS } from '../core/config';
import type { Building, GameState } from '../core/types';
import type { Assets } from './Assets';
import { teamStyle } from './teams';

interface BuildingView {
  root: THREE.Group;
  model: THREE.Object3D;
  completed: boolean;
  hpGroup: THREE.Group;
  hpFill: THREE.Mesh;
}

/**
 * Mirrors GameState buildings into the 3D scene (soldiers and villagers: CrowdRenderer).
 * No game rules here: it only reads state.
 */
export class EntityRenderer {
  readonly root = new THREE.Group();
  private buildings = new Map<string, BuildingView>();
  private barGeo = new THREE.PlaneGeometry(1, 0.08);
  /** Same plane with its origin on the left edge, so scaling x shrinks it from the right. */
  private fillGeo = new THREE.PlaneGeometry(1, 0.08).translate(0.5, 0, 0);

  constructor(private assets: Assets) {}

  sync(state: GameState): void {
    this.syncBuildings(state);
  }

  /** Building root objects, for tap raycasting. userData.buildingId is set on each. */
  get buildingObjects(): THREE.Object3D[] {
    return [...this.buildings.values()].map((v) => v.root);
  }

  private syncBuildings(state: GameState): void {
    for (const b of Object.values(state.buildings)) {
      let view = this.buildings.get(b.id);
      const completed = b.buildProgress >= 1;
      if (!view) {
        view = this.createBuilding(b, completed);
        this.buildings.set(b.id, view);
        this.root.add(view.root);
      } else if (view.completed !== completed) {
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
      this.root.remove(view.root);
      this.buildings.delete(id);
    }
  }

  private createBuilding(b: Building, completed: boolean): BuildingView {
    const size = BUILDINGS[b.type].size;
    const root = new THREE.Group();
    root.position.set(b.tx + size / 2, 0, b.ty + size / 2);
    root.userData.buildingId = b.id;
    const model = this.buildingModel(b, completed);
    root.add(model);

    const style = teamStyle(b.ownerId);
    if (b.type === 'townHall') {
      const flag = this.assets.flag(style.kaykit, style.tint);
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
    return { root, model, completed, hpGroup, hpFill };
  }

  private buildingModel(b: Building, completed: boolean): THREE.Object3D {
    const size = BUILDINGS[b.type].size;
    if (!completed) return this.assets.neutral('building_scaffolding', size * 0.85);
    const style = teamStyle(b.ownerId);
    if (b.type === 'armyCamp') return this.assets.armyCamp(style.kaykit, style.tint);
    const variant = Number(b.id.split('-')[1]) || 0;
    return this.assets.building(b.type, style.kaykit, variant, size * 0.95, style.marker);
  }
}
