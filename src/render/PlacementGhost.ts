import * as THREE from 'three';
import { BUILDINGS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { BuildingType } from '../core/types';
import type { RtsCamera } from '../input/RtsCamera';
import type { PlaceCheck } from '../systems/ConstructionSystem';
import type { Assets } from './Assets';
import { teamStyle } from './teams';

const OK_COLOR = new THREE.Color(0x2ecc71);
const BAD_COLOR = new THREE.Color(0xe74c3c);
/** Grabbing within this many tiles around the footprint drags the ghost instead of the camera. */
const GRAB_MARGIN = 1;
/** How far (tiles) from the screen center we look for a valid first spot. */
const SEARCH_RADIUS = 12;

/**
 * Clash-of-Clans-style placement: a translucent model + footprint tiles, green when the
 * spot is valid, red otherwise. A finger drag that starts on the ghost moves it (the camera
 * stays put); drags elsewhere still pan. Rules come from `check` (ConstructionSystem).
 */
export class PlacementGhost {
  readonly root = new THREE.Group();
  type: BuildingType | null = null;
  tx = 0;
  ty = 0;
  private model?: THREE.Object3D;
  private materials: THREE.MeshStandardMaterial[] = [];
  private tileMat = new THREE.MeshBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.5, depthWrite: false });
  /** Footprint tiles in one draw call (largest building is 3×3). */
  private tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), this.tileMat, 9);
  private dragId: number | null = null;
  private grab = new THREE.Vector2();
  private last: PlaceCheck | null = null;

  constructor(
    private assets: Assets,
    private cam: RtsCamera,
    private canvas: HTMLCanvasElement,
    private check: (type: BuildingType, tx: number, ty: number) => PlaceCheck,
    private heightAt: (x: number, z: number) => number,
  ) {
    this.root.visible = false;
    this.tiles.renderOrder = 5;
    this.root.add(this.tiles);
    // Capture phase on the parent: runs before RtsCamera's listeners on the canvas.
    const parent = canvas.parentElement!;
    parent.addEventListener('pointerdown', this.onDown, true);
    parent.addEventListener('pointermove', this.onMove, true);
    parent.addEventListener('pointerup', this.onUp, true);
    parent.addEventListener('pointercancel', this.onUp, true);
  }

  get active(): boolean {
    return this.type !== null;
  }

  /** Shows the ghost of `type`, on the closest valid spot to (cx, cy) if there is one. */
  start(type: BuildingType, cx: number, cy: number): void {
    this.stop();
    this.type = type;
    const size = BUILDINGS[type].size;
    const style = teamStyle(PLAYER_ID);
    this.model = this.assets.building(type, style.kaykit, 0, size * 0.95, style.tint);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.transparent = true;
      mat.opacity = 0.85;
      mat.emissiveIntensity = 0.3;
      mesh.material = mat;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.materials.push(mat);
    });
    this.model.position.add(new THREE.Vector3(size / 2, 0.02, size / 2));
    this.root.add(this.model);
    const m = new THREE.Matrix4();
    for (let i = 0; i < size * size; i++) {
      this.tiles.setMatrixAt(i, m.makeTranslation((i % size) + 0.5, 0.03, Math.floor(i / size) + 0.5));
    }
    this.tiles.count = size * size;
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.computeBoundingSphere();
    const spot = this.findSpot(type, cx, cy);
    this.moveTo(spot.tx, spot.ty);
    this.root.visible = true;
  }

  stop(): void {
    this.type = null;
    this.dragId = null;
    this.last = null;
    this.root.visible = false;
    if (this.model) this.root.remove(this.model);
    this.model = undefined;
    this.materials.forEach((m) => m.dispose());
    this.materials = [];
  }

  moveTo(tx: number, ty: number): void {
    this.tx = tx;
    this.ty = ty;
    const size = this.type ? BUILDINGS[this.type].size : 1;
    this.root.position.set(tx, this.heightAt(tx + size / 2, ty + size / 2), ty);
  }

  /** A tap on the map moves the ghost so it is centered on the tapped tile. */
  tapAt(ndc: THREE.Vector2): void {
    if (!this.type) return;
    const p = this.cam.groundPoint(ndc);
    if (!p) return;
    const half = Math.floor(BUILDINGS[this.type].size / 2);
    this.moveTo(Math.floor(p.x) - half, Math.floor(p.z) - half);
  }

  /** Re-checks the spot (resources and buildings change over time) and recolors. Call every frame. */
  update(): PlaceCheck | null {
    if (!this.type) return null;
    const res = this.check(this.type, this.tx, this.ty);
    if (res.ok !== this.last?.ok) {
      const color = res.ok ? OK_COLOR : BAD_COLOR;
      this.tileMat.color.copy(color);
      for (const m of this.materials) m.emissive.copy(color);
    }
    this.last = res;
    return res;
  }

  /**
   * Ring search for the closest valid top-left tile around (cx, cy). Within a ring, spots on
   * the camera side (+x +z) win so the ghost isn't hidden behind other buildings.
   */
  private findSpot(type: BuildingType, cx: number, cy: number): { tx: number; ty: number } {
    const half = Math.floor(BUILDINGS[type].size / 2);
    const ox = Math.floor(cx) - half;
    const oy = Math.floor(cy) - half;
    for (let r = 0; r <= SEARCH_RADIUS; r++) {
      let best: { tx: number; ty: number } | null = null;
      let bestScore = -Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || dx + dy <= bestScore) continue;
          // Ignore the cost here: an unaffordable building still gets a sensible spot.
          const res = this.check(type, ox + dx, oy + dy);
          if (res.ok || res.reason === 'Pas assez de ressources') {
            best = { tx: ox + dx, ty: oy + dy };
            bestScore = dx + dy;
          }
        }
      }
      if (best) return best;
    }
    return { tx: ox, ty: oy };
  }

  private ground(e: PointerEvent): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.cam.groundPoint(ndc);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.type || e.target !== this.canvas || this.dragId !== null) return;
    const p = this.ground(e);
    if (!p) return;
    const size = BUILDINGS[this.type].size;
    const inside =
      p.x >= this.tx - GRAB_MARGIN && p.x <= this.tx + size + GRAB_MARGIN &&
      p.z >= this.ty - GRAB_MARGIN && p.z <= this.ty + size + GRAB_MARGIN;
    if (!inside) return;
    e.stopPropagation();
    this.dragId = e.pointerId;
    this.grab.set(this.tx - p.x, this.ty - p.z);
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    e.stopPropagation();
    const p = this.ground(e);
    if (p) this.moveTo(Math.round(p.x + this.grab.x), Math.round(p.z + this.grab.y));
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    e.stopPropagation();
    this.dragId = null;
  };
}
