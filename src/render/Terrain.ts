import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { TileType } from '../core/types';
import type { WorldGen } from '../world/WorldGen';
import { NATURE, type Assets, type MeshPart } from './Assets';
import { fogMaterial } from './FogOfWar';

/** Top height of each tile type (world units, 1 tile = 1 unit). */
export const TILE_HEIGHT: Record<TileType, number> = {
  water: -0.35,
  sand: -0.04,
  grass: 0,
  forest: 0,
  rock: 0.12,
  ore: 0.12,
};

export const TILE_COLOR: Record<TileType, number> = {
  water: 0x2b6a8f,
  sand: 0xe6d29a,
  grass: 0x86c552,
  forest: 0x6aae3e,
  rock: 0xa5a29a,
  ore: 0x9c8a7a,
};

const ORE_TINT = new THREE.Color(0.95, 0.55, 0.35);

interface Chunk {
  group: THREE.Group;
}

/**
 * Infinite low-poly terrain, built per chunk:
 * one InstancedMesh of boxes for the ground + instanced trees and rocks.
 */
export class Terrain {
  readonly root = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private groundMat = fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  private treeParts: MeshPart[][];
  private rockParts: MeshPart[][];
  private oreParts: MeshPart[][];
  private water: THREE.Mesh;

  constructor(
    private world: WorldGen,
    assets: Assets,
    private chunkSize: number,
  ) {
    this.treeParts = NATURE.trees.map((n) => assets.parts(n, n.startsWith('trees_') ? 1.05 : 0.75));
    this.rockParts = NATURE.rocks.map((n) => assets.parts(n, 0.7));
    this.oreParts = this.rockParts.map((parts) =>
      parts.map((p) => {
        const mat = (p.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(ORE_TINT);
        return { geometry: p.geometry, material: mat };
      }),
    );
    for (const parts of [...this.treeParts, ...this.rockParts, ...this.oreParts]) for (const p of parts) fogMaterial(p.material);

    // One big translucent water plane following the camera.
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      fogMaterial(new THREE.MeshLambertMaterial({ color: 0x4aa3d8, transparent: true, opacity: 0.82 })),
    );
    this.water.position.y = -0.12;
    this.water.receiveShadow = true;
    this.root.add(this.water);
  }

  /** Loads chunks within `radius` tiles of the focus point and unloads the rest. */
  update(focus: THREE.Vector3, radius: number): void {
    this.water.position.x = focus.x;
    this.water.position.z = focus.z;
    const cs = this.chunkSize;
    const minCx = Math.floor((focus.x - radius) / cs);
    const maxCx = Math.floor((focus.x + radius) / cs);
    const minCy = Math.floor((focus.z - radius) / cs);
    const maxCy = Math.floor((focus.z + radius) / cs);
    const wanted = new Set<string>();
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx},${cy}`;
        wanted.add(key);
        if (!this.chunks.has(key)) {
          const chunk = this.buildChunk(cx, cy);
          this.chunks.set(key, chunk);
          this.root.add(chunk.group);
        }
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (wanted.has(key)) continue;
      this.disposeChunk(chunk);
      this.chunks.delete(key);
    }
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  private buildChunk(cx: number, cy: number): Chunk {
    const cs = this.chunkSize;
    const group = new THREE.Group();
    const ground = new THREE.InstancedMesh(this.box, this.groundMat, cs * cs);
    ground.receiveShadow = true;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const seed = this.world.seed;

    const trees: THREE.Matrix4[][] = this.treeParts.map(() => []);
    const rocks: THREE.Matrix4[][] = this.rockParts.map(() => []);
    const ores: THREE.Matrix4[][] = this.oreParts.map(() => []);

    let i = 0;
    for (let y = 0; y < cs; y++) {
      for (let x = 0; x < cs; x++) {
        const tx = cx * cs + x;
        const ty = cy * cs + y;
        const type = this.world.getTile(tx, ty);
        const h = TILE_HEIGHT[type];
        const r = hash2(tx, ty, seed);
        // Box from y=-1 to y=h so tiles never show gaps.
        m.makeScale(1, h + 1, 1).setPosition(tx + 0.5, (h - 1) / 2, ty + 0.5);
        ground.setMatrixAt(i, m);
        color.setHex(TILE_COLOR[type]).multiplyScalar(0.94 + r * 0.12);
        ground.setColorAt(i, color);
        i++;

        const r2 = hash2(tx + 7919, ty - 104729, seed);
        const ox = (r - 0.5) * 0.35;
        const oz = (r2 - 0.5) * 0.35;
        if (type === 'forest') {
          trees[Math.floor(r2 * trees.length)].push(placement(tx + 0.5 + ox, h, ty + 0.5 + oz, r * Math.PI * 2, 0.85 + r2 * 0.3));
        } else if (type === 'rock' && r < 0.45) {
          rocks[Math.floor(r2 * rocks.length)].push(placement(tx + 0.5 + ox, h, ty + 0.5 + oz, r2 * Math.PI * 2, 0.7 + r * 0.6));
        } else if (type === 'ore') {
          ores[Math.floor(r2 * ores.length)].push(placement(tx + 0.5, h, ty + 0.5, r * Math.PI * 2, 1.1));
        }
      }
    }
    ground.instanceMatrix.needsUpdate = true;
    ground.computeBoundingSphere();
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
    group.add(ground);

    // Trees don't cast shadows: they are the most numerous objects (big mobile GPU saving).
    addInstances(group, this.treeParts, trees, false);
    addInstances(group, this.rockParts, rocks, false);
    addInstances(group, this.oreParts, ores, false);
    return { group };
  }

  private disposeChunk(chunk: Chunk): void {
    this.root.remove(chunk.group);
    chunk.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
  }
}

function placement(x: number, y: number, z: number, rotY: number, scale: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
}

function addInstances(group: THREE.Group, variants: MeshPart[][], matrices: THREE.Matrix4[][], castShadow: boolean): void {
  variants.forEach((parts, v) => {
    const list = matrices[v];
    if (list.length === 0) return;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });
}
