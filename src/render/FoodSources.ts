import * as THREE from 'three';
import type { GameState } from '../core/types';

/** Simple instanced markers for finite food sources. */
export class FoodSources {
  readonly root = new THREE.Group();
  private berry = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0x397d35 }), 2048);
  private fruit = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshStandardMaterial({ color: 0xd52b28 }), 2048);
  private animal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.65, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: 0xb89973 }), 2048);
  constructor() { this.root.add(this.berry, this.fruit, this.animal); }
  sync(state: GameState): void {
    let berries = 0, animals = 0;
    const matrix = new THREE.Matrix4();
    for (const s of Object.values(state.foodSources)) {
      if (s.remaining <= 0) continue;
      if (s.type === 'berry' && berries < 2048) {
        this.berry.setMatrixAt(berries, matrix.makeTranslation(s.tx + 0.5, 0.35, s.ty + 0.5));
        this.fruit.setMatrixAt(berries++, matrix.makeTranslation(s.tx + 0.5, 0.7, s.ty + 0.5));
      } else if (s.type === 'animal' && animals < 2048) {
        this.animal.setMatrixAt(animals++, matrix.makeTranslation(s.tx + 0.5, 0.25, s.ty + 0.5));
      }
    }
    this.berry.count = this.fruit.count = berries; this.animal.count = animals;
    this.berry.instanceMatrix.needsUpdate = this.fruit.instanceMatrix.needsUpdate = this.animal.instanceMatrix.needsUpdate = true;
  }
}
