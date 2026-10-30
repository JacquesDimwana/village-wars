import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { BuildingType, UnitType } from '../core/types';
import type { KayKitColor } from './teams';

const BASE = `${import.meta.env.BASE_URL}models/`;
const COLORS: KayKitColor[] = ['blue', 'red', 'green', 'yellow'];
/** Keeps very tall models (castle, towers) from towering over the map. */
const MAX_HEIGHT_RATIO = 1.25;

/** KayKit model used for each building type (team-colored variants exist for all of them). */
export const BUILDING_MODELS: Record<BuildingType, string[]> = {
  townHall: ['castle'],
  house: ['home_A', 'home_B'],
  lumberCamp: ['lumbermill'],
  quarry: ['tower_base'],
  mine: ['mine'],
  smelter: ['watermill'],
  barracks: ['barracks'],
  armory: ['blacksmith'],
  tower: ['tower_A'],
};

export const NATURE = {
  /** Weighted by repetition: mostly cheap single trees, some clusters. */
  trees: ['tree_single_A', 'tree_single_A', 'tree_single_B', 'tree_single_B', 'trees_A_small'],
  rocks: ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'],
};

const NEUTRAL = ['building_scaffolding', 'building_destroyed', 'resource_stone', 'resource_lumber'];

export const CHARACTER_FILES: Record<UnitType, string> = {
  knight: 'characters/Knight.glb',
  archer: 'characters/Rogue_Hooded.glb',
};

/** Weapon/prop meshes to keep visible on each character (the rest are hidden). */
const CHARACTER_KEEP: Record<UnitType, string[]> = {
  knight: ['1H_Sword', 'Round_Shield'],
  archer: ['2H_Crossbow'],
};
const CHARACTER_PROPS: Record<UnitType, string[]> = {
  knight: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'],
  archer: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
};

/** A static model flattened into geometry+material parts (for InstancedMesh). */
export interface MeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface CharacterAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Scale that makes the character `height` tiles tall. */
  baseScale: number;
}

/** Loads every model once at startup and hands out clones. */
export class Assets {
  private gltfs = new Map<string, GLTF>();
  private characters = new Map<UnitType, CharacterAsset>();
  private loader = new GLTFLoader();

  async loadAll(onProgress: (ratio: number) => void): Promise<void> {
    const files: string[] = [];
    for (const c of COLORS) {
      for (const names of Object.values(BUILDING_MODELS)) {
        for (const n of names) files.push(`kaykit/building_${n}_${c}.gltf`);
      }
      files.push(`kaykit/flag_${c}.gltf`);
    }
    for (const n of new Set([...NATURE.trees, ...NATURE.rocks, ...NEUTRAL])) files.push(`kaykit/${n}.gltf`);
    const charFiles = Object.values(CHARACTER_FILES);
    const total = files.length + charFiles.length;
    let done = 0;
    const tick = () => onProgress(++done / total);

    await Promise.all([
      ...files.map(async (f) => {
        this.gltfs.set(f, await this.loader.loadAsync(BASE + f));
        tick();
      }),
      ...(Object.entries(CHARACTER_FILES) as [UnitType, string][]).map(async ([type, f]) => {
        const gltf = await this.loader.loadAsync(BASE + f);
        this.prepareCharacter(type, gltf);
        tick();
      }),
    ]);
  }

  /** Clone of a building model, scaled to fit `footprint` tiles, base at y=0, centered. */
  building(type: BuildingType, color: KayKitColor, variant: number, footprint: number, tint?: THREE.Color): THREE.Object3D {
    const names = BUILDING_MODELS[type];
    const name = names[variant % names.length];
    return this.fitted(`kaykit/building_${name}_${color}.gltf`, footprint, tint);
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
    const gltf = this.require(`kaykit/${name}.gltf`);
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

  character(type: UnitType): CharacterAsset {
    const c = this.characters.get(type);
    if (!c) throw new Error(`Character not loaded: ${type}`);
    return c;
  }

  cloneCharacter(type: UnitType): THREE.Object3D {
    return SkeletonUtils.clone(this.character(type).scene);
  }

  private prepareCharacter(type: UnitType, gltf: GLTF): void {
    const keep = new Set(CHARACTER_KEEP[type]);
    const props = new Set(CHARACTER_PROPS[type]);
    gltf.scene.traverse((o) => {
      if (props.has(o.name)) o.visible = keep.has(o.name);
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const height = box.max.y - box.min.y || 1;
    this.characters.set(type, { scene: gltf.scene, clips: gltf.animations, baseScale: 0.85 / height });
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
