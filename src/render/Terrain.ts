import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { TileType } from '../core/types';
import type { WorldGen } from '../world/WorldGen';
import { NATURE, type Assets, type MeshPart } from './Assets';

/** Names used in the game’s visual direction and future biome UI. */
export const BIOME_NAMES = {
  solar: 'Royaume solaire',
  wild: 'Royaume sauvage',
  astral: 'Royaume astral',
} as const;

export type Biome = keyof typeof BIOME_NAMES;

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
  water: 0x4389a6,
  sand: 0xe8d09a,
  grass: 0x78b65c,
  forest: 0x57924c,
  rock: 0x9a9286,
  ore: 0xa77758,
};

/** Violet-blue palette for the rare Astral Realm areas of the map. */
const ASTRAL_TILE_COLOR: Record<TileType, number> = {
  water: 0x276f93,
  sand: 0xb1a5d8,
  grass: 0x6075a8,
  forest: 0x635693,
  rock: 0x77709f,
  ore: 0x9e6eac,
};

/** Warm, defensive Kingdom Wild palette for the autumn regions. */
const WILD_TILE_COLOR: Record<TileType, number> = {
  water: 0x497a82,
  sand: 0xc99d62,
  grass: 0x8a7444,
  forest: 0x43543b,
  rock: 0x8b7262,
  ore: 0xae6a3e,
};

const SOLAR_TREE_TINT = new THREE.Color(0.84, 1.04, 0.78);
const SOLAR_ROCK_TINT = new THREE.Color(1.06, 0.96, 0.84);
const ASTRAL_TREE_TINT = new THREE.Color(0.8, 0.7, 1.12);
const ASTRAL_ROCK_TINT = new THREE.Color(0.78, 0.76, 1.14);
const WILD_TREE_TINT = new THREE.Color(1.12, 0.78, 0.5);
const WILD_ROCK_TINT = new THREE.Color(1.14, 0.76, 0.56);

/**
 * Three equal, fixed map regions. Each 120° sector occupies one third of the
 * procedural world; the origin belongs to the solar kingdom.
 */
export function biomeAt(tx: number, ty: number): Biome {
  const angle = (Math.atan2(ty, tx) + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.floor((angle + Math.PI / 3) / ((Math.PI * 2) / 3)) % 3;
  return (['solar', 'wild', 'astral'] as const)[sector];
}

/** Final terrain color used by the world and the minimap. */
export function terrainColor(type: TileType, tx: number, ty: number): number {
  switch (biomeAt(tx, ty)) {
    case 'wild': return WILD_TILE_COLOR[type];
    case 'astral': return ASTRAL_TILE_COLOR[type];
    default: return TILE_COLOR[type];
  }
}

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
  private groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private treeParts: MeshPart[][];
  private rockParts: MeshPart[][];
  private oreParts: MeshPart[][];
  private astralTreeParts: MeshPart[][];
  private astralRockParts: MeshPart[][];
  private astralOreParts: MeshPart[][];
  private wildTreeParts: MeshPart[][];
  private wildRockParts: MeshPart[][];
  private wildOreParts: MeshPart[][];
  private water: THREE.Mesh;

  constructor(
    private world: WorldGen,
    assets: Assets,
    private chunkSize: number,
  ) {
    this.treeParts = NATURE.trees.map((asset) => tintParts(assets.parts(asset.file, asset.footprint), SOLAR_TREE_TINT));
    this.rockParts = NATURE.rocks.map((asset) => tintParts(assets.parts(asset.file, asset.footprint), SOLAR_ROCK_TINT));
    this.oreParts = this.rockParts.map((parts) =>
      parts.map((p) => {
        const mat = (p.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(ORE_TINT);
        return { geometry: p.geometry, material: mat };
      }),
    );
    this.astralTreeParts = this.treeParts.map((parts) => tintParts(parts, ASTRAL_TREE_TINT));
    this.astralRockParts = this.rockParts.map((parts) => tintParts(parts, ASTRAL_ROCK_TINT));
    this.astralOreParts = this.oreParts.map((parts) => tintParts(parts, ASTRAL_ROCK_TINT));
    this.wildTreeParts = this.treeParts.map((parts) => tintParts(parts, WILD_TREE_TINT));
    this.wildRockParts = this.rockParts.map((parts) => tintParts(parts, WILD_ROCK_TINT));
    this.wildOreParts = this.oreParts.map((parts) => tintParts(parts, WILD_ROCK_TINT));

    // One big translucent water plane following the camera.
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshPhongMaterial({
        color: 0x4e9fc4,
        specular: 0xa7e7f4,
        shininess: 48,
        transparent: true,
        opacity: 0.76,
      }),
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
    const astralTrees: THREE.Matrix4[][] = this.treeParts.map(() => []);
    const astralRocks: THREE.Matrix4[][] = this.rockParts.map(() => []);
    const astralOres: THREE.Matrix4[][] = this.oreParts.map(() => []);
    const wildTrees: THREE.Matrix4[][] = this.treeParts.map(() => []);
    const wildRocks: THREE.Matrix4[][] = this.rockParts.map(() => []);
    const wildOres: THREE.Matrix4[][] = this.oreParts.map(() => []);

    let i = 0;
    for (let y = 0; y < cs; y++) {
      for (let x = 0; x < cs; x++) {
        const tx = cx * cs + x;
        const ty = cy * cs + y;
        const type = this.world.getTile(tx, ty);
        const h = TILE_HEIGHT[type];
        const r = hash2(tx, ty, seed);
        const biome = biomeAt(tx, ty);
        // Box from y=-1 to y=h so tiles never show gaps.
        m.makeScale(1, h + 1, 1).setPosition(tx + 0.5, (h - 1) / 2, ty + 0.5);
        ground.setMatrixAt(i, m);
        color.setHex(terrainColor(type, tx, ty)).multiplyScalar(0.94 + r * 0.12);
        ground.setColorAt(i, color);
        i++;

        const r2 = hash2(tx + 7919, ty - 104729, seed);
        const ox = (r - 0.5) * 0.35;
        const oz = (r2 - 0.5) * 0.35;
        if (type === 'forest') {
          const list = biome === 'astral' ? astralTrees : biome === 'wild' ? wildTrees : trees;
          list[Math.floor(r2 * list.length)].push(placement(tx + 0.5 + ox, h, ty + 0.5 + oz, r * Math.PI * 2, 0.85 + r2 * 0.3));
        } else if (type === 'rock' && r < 0.7) {
          const list = biome === 'astral' ? astralRocks : biome === 'wild' ? wildRocks : rocks;
          list[Math.floor(r2 * list.length)].push(placement(tx + 0.5 + ox, h, ty + 0.5 + oz, r2 * Math.PI * 2, 0.55 + r * 0.7));
        } else if (type === 'ore') {
          const list = biome === 'astral' ? astralOres : biome === 'wild' ? wildOres : ores;
          list[Math.floor(r2 * list.length)].push(placement(tx + 0.5, h, ty + 0.5, r * Math.PI * 2, 1.1));
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
    addInstances(group, this.astralTreeParts, astralTrees, false);
    addInstances(group, this.astralRockParts, astralRocks, false);
    addInstances(group, this.astralOreParts, astralOres, false);
    addInstances(group, this.wildTreeParts, wildTrees, false);
    addInstances(group, this.wildRockParts, wildRocks, false);
    addInstances(group, this.wildOreParts, wildOres, false);
    return { group };
  }

  private disposeChunk(chunk: Chunk): void {
    this.root.remove(chunk.group);
    chunk.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
  }
}

function tintParts(parts: MeshPart[], tint: THREE.Color): MeshPart[] {
  return parts.map((part) => {
    const material = (part.material as THREE.MeshStandardMaterial).clone();
    material.color.multiply(tint);
    return { geometry: part.geometry, material };
  });
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
