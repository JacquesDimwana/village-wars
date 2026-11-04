import * as THREE from 'three';
import { RESOURCES } from '../core/config';
import type { GameState, Villager } from '../core/types';
import { isVisible } from '../systems/FogSystem';
import { isResourceTile, tileRemaining } from '../systems/GatherSystem';
import type { WorldGen } from '../world/WorldGen';
import { groundHeight } from './GroundSurface';

export const resourceRatio = (remaining: number, initial: number): number =>
  initial > 0 ? Math.max(0, Math.min(1, remaining / initial)) : 0;

/** One entry per finite source currently being worked, even with several workers. */
export function activeResourceSources(villagers: Iterable<Villager>): { tx: number; ty: number }[] {
  const result = new Map<string, { tx: number; ty: number }>();
  for (const v of villagers) {
    const h = v.harvest;
    if (v.task !== 'working' || !h || h.sourceType === 'farm') continue;
    result.set(`${h.tx},${h.ty}`, { tx: h.tx, ty: h.ty });
  }
  return [...result.values()];
}

type Particle = { tx: number; ty: number; age: number; index: number; color: number };

export class ResourceBars {
  readonly root = new THREE.Group();
  private background = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x202020, side: THREE.DoubleSide, depthTest: false }), 2048);
  private fill = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false }), 2048);
  private fragments = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0xffffff }), 2048);
  private recent = new Map<string, { tx: number; ty: number; until: number }>();
  private depleted = new Set<string>();
  private initialized = false;
  private particles: Particle[] = [];
  private clock = 0;

  constructor() {
    this.root.add(this.background, this.fill, this.fragments);
    this.background.frustumCulled = this.fill.frustumCulled = this.fragments.frustumCulled = false;
    this.background.renderOrder = 10; this.fill.renderOrder = 11;
    this.background.count = this.fill.count = this.fragments.count = 0;
  }

  sync(state: GameState, world: WorldGen, camera: THREE.Camera, dt: number): void {
    this.clock += dt;
    for (const source of activeResourceSources(Object.values(state.villagers))) {
      this.recent.set(`${source.tx},${source.ty}`, { ...source, until: this.clock + 2 });
    }
    const ended: { key: string; tx: number; ty: number; color: number }[] = [];
    for (const [key, remaining] of Object.entries(state.depletion)) {
      if (remaining > 0) continue;
      const [tx, ty] = key.split(',').map(Number);
      ended.push({ key: `t:${key}`, tx, ty, color: world.getTile(tx, ty) === 'forest' ? 0x8a5a32 : 0x99958a });
    }
    for (const source of Object.values(state.foodSources)) {
      if (source.remaining <= 0) ended.push({ key: `f:${source.id}`, tx: source.tx, ty: source.ty, color: source.type === 'berry' ? 0x54803d : 0x9b7758 });
    }
    for (const source of ended) {
      if (!this.depleted.has(source.key) && this.initialized && isVisible(state.fog, source.tx, source.ty)) {
        for (let i = 0; i < 8; i++) this.particles.push({ ...source, age: 0, index: i });
      }
      this.depleted.add(source.key);
    }
    this.initialized = true;
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
    const color = new THREE.Color(), rotation = camera.quaternion;
    let count = 0;
    for (const [key, source] of this.recent) {
      if (source.until < this.clock) { this.recent.delete(key); continue; }
      const { tx, ty } = source;
      if (!isVisible(state.fog, tx, ty)) continue;
      const food = Object.values(state.foodSources).find(s => s.tx === tx && s.ty === ty && s.remaining > 0);
      const tile = world.getTile(tx, ty);
      const remaining = food ? food.remaining : isResourceTile(tile) ? tileRemaining(state, tx, ty, tile) : 0;
      const initial = food ? RESOURCES.tileAmounts[food.type] : isResourceTile(tile) ? RESOURCES.tileAmounts[tile] : 0;
      const ratio = resourceRatio(remaining, initial);
      if (ratio <= 0 || count >= 2048) continue;
      const height = food ? 1.15 : tile === 'forest' ? 2.6 : 1.35;
      pos.set(tx + 0.5, height + groundHeight(world, tx + 0.5, ty + 0.5), ty + 0.5);
      matrix.compose(pos, rotation, scale.set(0.85, 0.13, 1)); this.background.setMatrixAt(count, matrix);
      const offset = new THREE.Vector3((ratio - 1) * 0.39, 0, 0.01).applyQuaternion(rotation);
      matrix.compose(pos.add(offset), rotation, scale.set(0.78 * ratio, 0.08, 1)); this.fill.setMatrixAt(count, matrix);
      color.set(ratio > 0.5 ? 0x54c83d : ratio > 0.25 ? 0xf0a52e : 0xe44232);
      this.fill.setColorAt(count++, color);
    }
    this.background.count = this.fill.count = count;
    this.background.instanceMatrix.needsUpdate = this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
    this.particles = this.particles.filter(p => (p.age += dt) < 0.6);
    let n = 0;
    for (const p of this.particles) {
      if (!isVisible(state.fog, p.tx, p.ty) || n >= 2048) continue;
      const angle = p.index * Math.PI / 4, t = p.age;
      pos.set(p.tx + 0.5 + Math.cos(angle) * t * 0.8, groundHeight(world, p.tx + 0.5, p.ty + 0.5) + 0.4 + t * 2 - 3 * t * t, p.ty + 0.5 + Math.sin(angle) * t * 0.8);
      matrix.makeTranslation(pos.x, pos.y, pos.z); this.fragments.setMatrixAt(n, matrix);
      this.fragments.setColorAt(n++, color.setHex(p.color));
    }
    this.fragments.count = n; this.fragments.instanceMatrix.needsUpdate = true;
    if (this.fragments.instanceColor) this.fragments.instanceColor.needsUpdate = true;
  }
}
