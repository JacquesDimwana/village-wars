import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { paletteCharacter, rangerAtlas } from './QuaterniusMaterials';
// Three.js does not currently ship types for its bundled meshoptimizer.
// @ts-expect-error No declaration for the bundled meshoptimizer module.
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { BuildingType } from '../core/types';
import type { KayKitColor } from './teams';
import { BuildingKit, KIT_PARTS } from './BuildingKit';
import { bakeCharacter, type BakeSpec, type VatModel } from './VatBaker';

const BASE = `${import.meta.env.BASE_URL}models/`;
const COLORS: KayKitColor[] = ['blue', 'red', 'green', 'yellow'];
/** Keeps very tall models (castle, towers) from towering over the map. */
const MAX_HEIGHT_RATIO = 1.25;

export const NATURE = {
  /** Weighted by repetition: mostly cheap single trees, some clusters. */
  trees: ['CommonTree_5', 'Pine_5'],
  rocks: ['Rock_Medium_1', 'Rock_Medium_2'],
};

const NEUTRAL = ['building_scaffolding', 'building_destroyed', 'resource_stone', 'resource_lumber', 'rock_single_A', 'rock_single_C', 'rock_single_E'];

/** Crowd models drawn with vertex animation textures. */
export type CrowdModelKind = 'knight' | 'archer' | 'villager';
const CHARACTER_HEIGHT = 0.85;
// The knight FBX exports near-black diffuse values for these materials.
const KNIGHT_PALETTE: Record<string, number> = {
  Skin: 0xe6b58c, Armor: 0x9aa8b3, Armor_Dark: 0x566572,
  Detail: 0x986137, Red: 0xb63228,
};

function addKnightSword(scene: THREE.Object3D): void {
  const hand = scene.getObjectByName('FistR');
  if (!hand) throw new Error('Knight right hand bone not found');
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.85, 0.04), new THREE.MeshStandardMaterial({ color: 0xb8c3ca }));
  blade.position.y = 0.56;
  hand.add(blade);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.07), new THREE.MeshStandardMaterial({ color: 0x77838b }));
  guard.position.y = 0.16;
  hand.add(guard);
}
const CROWD_SPECS: Record<CrowdModelKind, { file: string; spec: BakeSpec }> = {
  knight: {
    file: 'quaternius/characters/Knight_Male.fbx',
    spec: { props: [], keep: [], height: CHARACTER_HEIGHT * 1.1, clips: [
      { name: 'idle', clip: 'CharacterArmature|Idle', frames: 4 },
      { name: 'walk', clip: 'CharacterArmature|Walk', frames: 8 },
      { name: 'attack', clip: 'CharacterArmature|Punch', frames: 6 },
    ] },
  },
  archer: {
    file: 'quaternius/ranger/Ranger.fbx',
    spec: { props: [], keep: [], height: CHARACTER_HEIGHT, clips: [
      { name: 'idle', clip: 'CharacterArmature|Idle_Weapon', frames: 4 },
      { name: 'walk', clip: 'CharacterArmature|Walk', frames: 8 },
      { name: 'attack', clip: 'CharacterArmature|Bow_Attack_Shoot', frames: 6 },
    ] },
  },
  villager: {
    file: 'quaternius/characters/Worker_Male.fbx',
    spec: { props: [], keep: [], height: CHARACTER_HEIGHT, clips: [
      { name: 'idle', clip: 'CharacterArmature|Idle', frames: 4 },
      { name: 'walk', clip: 'CharacterArmature|Walk', frames: 8 },
      { name: 'carry', clip: 'CharacterArmature|Walk_Carry', frames: 8 },
      { name: 'work', clip: 'CharacterArmature|PickUp', frames: 6 },
    ] },
  },
};

/** A static model flattened into geometry+material parts (for InstancedMesh). */
export interface MeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Loads every model once at startup and hands out clones. */
export class Assets {
  private gltfs = new Map<string, GLTF>();
  private crowd = new Map<CrowdModelKind, VatModel>();
  private loader = new GLTFLoader();
  private buildingKit?: BuildingKit;

  async loadAll(onProgress: (ratio: number) => void): Promise<void> {
    const files: string[] = [];
    for (const c of COLORS) {
      files.push(`kaykit/flag_${c}.gltf`, `kaykit/building_castle_${c}.gltf`);
    }
    for (const n of NEUTRAL) files.push(`kaykit/${n}.gltf`);
    for (const n of [...NATURE.trees, ...NATURE.rocks]) files.push(`quaternius/nature/${n}.gltf`);
    files.push(...KIT_PARTS.map((name) => `quaternius/medieval/${name}.gltf`));
    const charFiles = Object.values(CROWD_SPECS).map(({ file }) => file);
    const fbxLoader = new FBXLoader();
    const characters = new Map<string, THREE.Group>();
    const total = files.length + charFiles.length;
    let done = 0;
    const tick = () => onProgress(++done / total);

    await Promise.all([
      ...files.map(async (f) => {
        this.gltfs.set(f, await this.loader.loadAsync(BASE + f));
        tick();
      }),
      ...charFiles.map(async (f) => {
        characters.set(f, await fbxLoader.loadAsync(BASE + f));
        tick();
      }),
    ]);
    // Reduce the original castle once per team; instances share the resulting geometry.
    await MeshoptSimplifier.ready;
    for (const color of COLORS) {
      const scene = this.require(`kaykit/building_castle_${color}.gltf`).scene;
      const meshes: THREE.Mesh[] = [];
      scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
        if (triangles > 2900) {
          const position = geometry.getAttribute('position');
          const positions = new Float32Array(position.count * 3);
          for (let i = 0; i < position.count; i++) {
            positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
          }
          const indices = geometry.index?.array;
          if (!indices || !(indices instanceof Uint16Array || indices instanceof Uint32Array)) {
            throw new Error('Castle geometry requires indexed triangles');
          }
          const [simplified] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, 8400, 1) as [Uint16Array | Uint32Array, number];
          if (simplified.length > 9000) throw new Error('Castle exceeds triangle budget');
          mesh.geometry = geometry.clone();
          mesh.geometry.setIndex(new THREE.BufferAttribute(simplified, 1));
          geometry.dispose();
        }
      }
    }
    const atlas = await new THREE.TextureLoader().loadAsync(`${BASE}quaternius/medieval/atlas.png`);
    this.buildingKit = new BuildingKit((name) => this.require(`quaternius/medieval/${name}.gltf`).scene, atlas);
    for (const [kind, { file, spec }] of Object.entries(CROWD_SPECS) as [CrowdModelKind, (typeof CROWD_SPECS)[CrowdModelKind]][]) {
      const scene = characters.get(file);
      if (!scene) throw new Error(`Character not loaded: ${file}`);
      if (kind === 'archer') await rangerAtlas(scene, BASE + 'quaternius/ranger/');
      else {
        if (kind === 'knight') addKnightSword(scene);
        paletteCharacter(scene, kind === 'knight' ? KNIGHT_PALETTE : {});
      }
      this.crowd.set(kind, bakeCharacter(scene, scene.animations, spec));
    }
  }

  /** Clone of a building model, scaled to fit `footprint` tiles, base at y=0, centered. */
  building(type: BuildingType, color: KayKitColor, variant: number, footprint: number, tint?: THREE.Color): THREE.Object3D {
    if (type === 'townHall') return this.fitted(`kaykit/building_castle_${color}.gltf`, footprint, tint);
    if (!this.buildingKit) throw new Error('Building kit not loaded');
    return this.buildingKit.create(type, variant, footprint, tint ?? new THREE.Color(0xffffff));
  }

  neutral(name: string, footprint: number): THREE.Object3D {
    return this.fitted(`kaykit/${name}.gltf`, footprint);
  }

  flag(color: KayKitColor, tint?: THREE.Color): THREE.Object3D {
    const obj = this.fitted(`kaykit/flag_${color}.gltf`, 0.6, tint);
    return obj;
  }

  /**
   * Static model flattened into parts (world transforms baked) for instancing,
   * scaled so its widest horizontal side equals `footprint`, base at y=0, centered.
   */
  parts(name: string, footprint: number): MeshPart[] {
    const gltf = this.require(`quaternius/nature/${name}.gltf`);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = footprint / Math.max(size.x, size.z, 0.001);
    const normalize = new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    const parts: MeshPart[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(normalize);
      parts.push({ geometry, material: mesh.material as THREE.Material });
    });
    return parts;
  }

  /** Baked (VAT) crowd model: one geometry + animated vertex textures. */
  crowdModel(kind: CrowdModelKind): VatModel {
    const m = this.crowd.get(kind);
    if (!m) throw new Error(`Crowd model not baked: ${kind}`);
    return m;
  }

  /** Scales to fit `footprint` tiles wide, but never taller than `footprint * MAX_HEIGHT_RATIO`. */
  private fitted(file: string, footprint: number, tint?: THREE.Color): THREE.Object3D {
    const src = this.require(file).scene;
    const model = src.clone(true);
    if (tint && (tint.r !== 1 || tint.g !== 1 || tint.b !== 1)) {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(tint);
        mesh.material = mat;
      });
    }
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = Math.min(footprint / Math.max(size.x, size.z, 0.001), (footprint * MAX_HEIGHT_RATIO) / Math.max(size.y, 0.001));
    model.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    const wrapper = new THREE.Group();
    wrapper.add(model);
    return wrapper;
  }

  private require(file: string): GLTF {
    const g = this.gltfs.get(file);
    if (!g) throw new Error(`Model not loaded: ${file}`);
    return g;
  }
}
