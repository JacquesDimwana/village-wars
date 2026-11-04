import { fogMaterial } from './FogOfWar';
import { groundHeight, groundWeights, groundMaterial } from './GroundSurface';
import * as THREE from 'three';
import { GAME } from '../core/config';
import { hash2 } from '../core/rng';
import { currentTile } from '../world/tiles';
import type { GameState, TileType } from '../core/types';
import type { WorldGen } from '../world/WorldGen';
import { NATURE, type Assets, type MeshPart } from './Assets';
import { mergePlaced, simplifyStatic, type MergeEntry } from './TerrainLod';
import { natureMaterial, oreVeins, prepareNature } from './NatureAssets';

/** Top height of each tile type (world units, 1 tile = 1 unit). */
export const TILE_HEIGHT: Record<TileType, number> = {
  water: -0.35,
  sand: -0.04,
  grass: 0,
  forest: 0,
  rock: 0.12,
  iron: 0.12,
};

export const TILE_COLOR: Record<TileType, number> = {
  water: 0x557e84,
  sand: 0xb7a483,
  grass: 0x87966c,
  forest: 0x536d4d,
  rock: 0xa39f91,
  iron: 0x75675d,
};

const ORE_TINT = new THREE.Color(0.72, 0.62, 0.56);

/**
 * Level of detail per chunk, from the camera distance to the chunk (strategic view):
 * 0 = instanced nature models; 1 = simplified models merged into one mesh;
 * 2 = same with flat ground tiles.
 */
const LOD_DISTANCES = [55, 85];
/** Distance margin before switching back, so chunks don't flicker between levels. */
const LOD_HYSTERESIS = 5;
/** Level changes rebuilt per frame (new chunks are always built at once). */
const LOD_REBUILDS_PER_FRAME = 3;
/** Clustering cell of the simplified nature models per level 1, 2 (world units). */
const LOD_CELLS = [0.25, 0.4];

/** Ground area to load: axis-aligned bounds in world units. */
export interface ViewBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Chunk {
  group: THREE.Group;
  lod: number;
}

/**
 * Low-poly terrain, built per chunk:
 * one InstancedMesh of boxes for the ground + instanced trees and rocks.
 */
export class Terrain {
  readonly root = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private groundMat = fogMaterial(groundMaterial());
  private treeParts: MeshPart[][];
  private rockParts: MeshPart[][];
  private oreParts: MeshPart[][];
  private waterMaterial: THREE.MeshStandardMaterial;
  private waterTime = { value: 0 };
  private depleted = new Set<string>();
  /** Flat top-face tile for far ground (2 triangles instead of 12). */

  /** Simplified models per level: [level - 1][variant][part]. */
  private lodTrees: THREE.BufferGeometry[][][];
  private lodRocks: THREE.BufferGeometry[][][];
  private lodOres: THREE.BufferGeometry[][][];
  private lodMat: THREE.MeshStandardMaterial;

  constructor(
    private world: WorldGen,
    assets: Assets,
    private chunkSize: number,
  ) {
    const rawTrees = NATURE.trees.map((n) => assets.parts(n, 0.75));
    const rawRocks = NATURE.rocks.map((n) => assets.parts(n, 0.7));
    const material = natureMaterial([...rawTrees, ...rawRocks]);
    this.treeParts = rawTrees.map((parts) => prepareNature(parts, material, true));
    this.rockParts = rawRocks.map((parts) => prepareNature(parts, material, false));
    [...rawTrees, ...rawRocks].flat().forEach((part) => part.geometry.dispose());
    const oreMaterial = material.clone();
    oreMaterial.color.copy(ORE_TINT);
    this.oreParts = this.rockParts.map((parts) => parts.map((p) => ({
      geometry: oreVeins(p.geometry), material: oreMaterial,
    })));

    const simplified = (variants: MeshPart[][], cell: number): THREE.BufferGeometry[][] =>
      variants.map((parts) => parts.map((p) => simplifyStatic(p.geometry, cell)));
    this.lodTrees = LOD_CELLS.map((c) => simplified(this.treeParts, c));
    this.lodRocks = LOD_CELLS.map((c) => simplified(this.rockParts, c * 0.6));
    this.lodOres = this.lodRocks.map((variants) => variants.map((parts) => parts.map(oreVeins)));
    this.lodMat = material.clone();
    this.lodMat.vertexColors = true;
    fogMaterial(material);
    fogMaterial(oreMaterial);
    fogMaterial(this.lodMat);

    this.waterMaterial = new THREE.MeshStandardMaterial({ color: 0x668f91, roughness: 0.28, metalness: 0.08 });
    this.waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.waterTime = this.waterTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float depth; varying float vDepth; varying vec2 vWater;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth=depth; vWater=(modelMatrix*vec4(position,1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float waterTime; varying float vDepth; varying vec2 vWater;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float ripple=sin(dot(vWater,vec2(1.3,2.7))+waterTime*0.53)*sin(dot(vWater,vec2(2.6,-1.4))-waterTime*0.38);
        float wave=sin(vWater.x*2.1+waterTime*0.7+ripple)*sin(vWater.y*1.7-waterTime*0.5)*0.5+0.5;
        float deep=smoothstep(0.0,0.35,vDepth);
        vec3 water=mix(vec3(0.36,0.56,0.53),vec3(0.10,0.26,0.31),deep);
        float foam=(1.0-smoothstep(0.015,0.11,vDepth))*smoothstep(0.42,0.85,wave);
        float fresnel=pow(1.0-abs(normalize(vViewPosition).z),3.0);
        diffuseColor.rgb=mix(water,vec3(0.48,0.62,0.65),fresnel*0.35)+wave*0.045+foam*vec3(0.22,0.25,0.22);`);
    };
    fogMaterial(this.waterMaterial);
  }

  /**
   * Loads chunks within `radius` tiles of the focus point (clipped to `view`, the ground
   * area seen by the camera, when given) and unloads the rest. `eye` (camera position)
   * picks each chunk's level of detail.
   */
  update(state: GameState, focus: THREE.Vector3, radius: number, eye?: THREE.Vector3, view?: ViewBounds, cameraDistance = 0): void {
    for (const [key, amount] of Object.entries(state.depletion)) {
      if (amount > 0 || this.depleted.has(key)) continue;
      this.depleted.add(key);
      const [x, y] = key.split(',').map(Number);
      // The blended surface samples adjacent tiles, including across chunk boundaries.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const chunkKey = `${Math.floor((x + dx) / this.chunkSize)},${Math.floor((y + dz) / this.chunkSize)}`;
        const chunk = this.chunks.get(chunkKey);
        if (chunk) { this.disposeChunk(chunk); this.chunks.delete(chunkKey); }
      }
    }
    this.waterTime.value = performance.now() * 0.001;
    const cs = this.chunkSize;
    const limit = GAME.map.halfSize + GAME.map.borderWidth;
    const minCx = Math.floor(Math.max(-limit, focus.x - radius, view?.minX ?? -Infinity) / cs);
    const maxCx = Math.floor(Math.min(limit, focus.x + radius, view?.maxX ?? Infinity) / cs);
    const minCy = Math.floor(Math.max(-limit, focus.z - radius, view?.minZ ?? -Infinity) / cs);
    const maxCy = Math.floor(Math.min(limit, focus.z + radius, view?.maxZ ?? Infinity) / cs);
    const wanted = new Set<string>();
    let rebuilds = 0;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx},${cy}`;
        wanted.add(key);
        const old = this.chunks.get(key);
        const lod = Math.max(cameraDistance > 30 ? 1 : 0, eye ? this.lodFor(cx, cy, eye, old?.lod) : 0);
        if (old && (old.lod === lod || rebuilds >= LOD_REBUILDS_PER_FRAME)) continue;
        if (old) {
          rebuilds++;
          this.disposeChunk(old);
        }
        const chunk = this.buildChunk(state, cx, cy, lod);
        this.chunks.set(key, chunk);
        this.root.add(chunk.group);
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

  /** Level of detail from the camera distance to the closest point of the chunk. */
  private lodFor(cx: number, cy: number, eye: THREE.Vector3, current = 0): number {
    const cs = this.chunkSize;
    const dx = Math.max(cx * cs - eye.x, 0, eye.x - (cx + 1) * cs);
    const dz = Math.max(cy * cs - eye.z, 0, eye.z - (cy + 1) * cs);
    const d = Math.hypot(dx, dz, eye.y);
    let lod = 0;
    for (const [i, limit] of LOD_DISTANCES.entries()) {
      // Hysteresis: a chunk already at a coarser level needs to come a bit closer to refine.
      if (d > limit - (current > i ? LOD_HYSTERESIS : 0)) lod = i + 1;
    }
    return lod;
  }

  private buildChunk(state: GameState, cx: number, cy: number, lod: number): Chunk {
    const cs = this.chunkSize;
    const group = new THREE.Group();
    const seed = this.world.seed;
    const segments = cs * 2;
    const geometry = new THREE.PlaneGeometry(cs, cs, segments, segments).rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position');
    const splat: number[] = [], ore: number[] = [], depth: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + cx * cs + cs / 2, z = position.getZ(i) + cy * cs + cs / 2;
      const w = groundWeights(x, z, (tx, tz) => currentTile(state, this.world, tx, tz));
      const h = groundHeight(this.world, x, z);
      position.setY(i, h);
      splat.push(w[0], w[1], w[2] + w[5], w[3] + w[4]); ore.push(w[4]); depth.push(-0.12 - h);
    }
    geometry.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4));
    geometry.setAttribute('oreWeight', new THREE.Float32BufferAttribute(ore, 1));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, this.groundMat);
    ground.position.set(cx * cs + cs / 2, 0, cy * cs + cs / 2);
    ground.receiveShadow = true;
    group.add(ground);
    if (depth.some(d => d > 0)) {
      const waterGeometry = new THREE.PlaneGeometry(cs, cs, segments, segments).rotateX(-Math.PI / 2);
      waterGeometry.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
      const water = new THREE.Mesh(waterGeometry, this.waterMaterial);
      water.position.set(cx * cs + cs / 2, -0.12, cy * cs + cs / 2);
      group.add(water);
    }
    const trees: THREE.Matrix4[][] = this.treeParts.map(() => []);
    const rocks: THREE.Matrix4[][] = this.rockParts.map(() => []);
    const ores: THREE.Matrix4[][] = this.oreParts.map(() => []);

    for (let y = 0; y < cs; y++) {
      for (let x = 0; x < cs; x++) {
        const tx = cx * cs + x;
        const ty = cy * cs + y;
        const type = currentTile(state, this.world, tx, ty);
        const h = groundHeight(this.world, tx + 0.5, ty + 0.5);
        const r = hash2(tx, ty, seed);
        const r2 = hash2(tx + 7919, ty - 104729, seed);
        const ox = (r - 0.5) * 0.35;
        const oz = (r2 - 0.5) * 0.35;
        if (type === 'forest' && r < (lod === 0 ? 0.55 : lod === 1 ? 0.25 : 0.14)) {
          trees[Math.floor(r2 * trees.length)].push(placement(tx + 0.5 + ox * 0.35, h, ty + 0.5 + oz * 0.35, r * Math.PI * 2, 0.95 + r2 * 0.1));
        } else if (type === 'rock' && r < 0.45) {
          rocks[Math.floor(r2 * rocks.length)].push(placement(tx + 0.5 + ox, h, ty + 0.5 + oz, r2 * Math.PI * 2, 0.7 + r * 0.6));
        } else if (type === 'iron') {
          ores[Math.floor(r2 * ores.length)].push(placement(tx + 0.5, h, ty + 0.5, r * Math.PI * 2, 1.1));
        }
      }
    }

    if (lod > 0) {
      // Far: every tree / rock of the chunk merged into one simplified mesh (1 draw call).
      const white = new THREE.Color(1, 1, 1);
      const entries: MergeEntry[] = [];
      const add = (variants: THREE.BufferGeometry[][], matrices: THREE.Matrix4[][], color: THREE.Color): void =>
        variants.forEach((geos, v) => geos.forEach((geometry) => entries.push({ geometry, matrices: matrices[v], color })));
      add(this.lodTrees[lod - 1], trees, white);
      add(this.lodRocks[lod - 1], rocks, white);
      add(this.lodOres[lod - 1], ores, ORE_TINT);
      const merged = mergePlaced(entries);
      if (merged) {
        const mesh = new THREE.Mesh(merged, this.lodMat);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return { group, lod };
    }
    // Trees don't cast shadows: they are the most numerous objects (big mobile GPU saving).
    addInstances(group, this.treeParts, trees, false);
    addInstances(group, this.rockParts, rocks, false);
    addInstances(group, this.oreParts, ores, false);
    return { group, lod };
  }

  private disposeChunk(chunk: Chunk): void {
    this.root.remove(chunk.group);
    chunk.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      else if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
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
      const tint = new THREE.Color();
      list.forEach((mat, i) => {
        mesh.setMatrixAt(i, mat);
        const variation = 0.87 + hash2(Math.round(mat.elements[12] * 10), Math.round(mat.elements[14] * 10), 73) * 0.20;
        mesh.setColorAt(i, tint.setRGB(variation, variation * 1.015, variation * 0.96));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });
}
