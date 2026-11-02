import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { BuildingType, UnitType } from '../core/types';
import type { KayKitColor } from './teams';
import { bakeCharacter, type BakeSpec, type VatModel } from './VatBaker';

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
  /** No KayKit model: composed in Assets.armyCamp(). */
  armyCamp: [],
};

export const NATURE = {
  /** Weighted by repetition: mostly cheap single trees, some clusters. */
  trees: ['CommonTree_5', 'Pine_5'],
  rocks: ['Rock_Medium_1', 'Rock_Medium_2'],
};

const NEUTRAL = ['building_scaffolding', 'building_destroyed', 'resource_stone', 'resource_lumber', 'rock_single_A', 'rock_single_C', 'rock_single_E'];

export const CHARACTER_FILES: Record<UnitType, string> = {
  knight: 'characters/Knight.glb',
  archer: 'characters/Rogue_Hooded.glb',
};

const PROPS: Record<UnitType, string[]> = {
  knight: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'],
  archer: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
};

/** Crowd models drawn with vertex animation textures (see VatBaker / CrowdRenderer). */
export type CrowdModelKind = 'knight' | 'archer' | 'villager';

const CHARACTER_HEIGHT = 0.85;
const CROWD_SPECS: Record<CrowdModelKind, { file: string; spec: BakeSpec }> = {
  knight: {
    file: CHARACTER_FILES.knight,
    spec: {
      props: PROPS.knight,
      keep: ['1H_Sword', 'Round_Shield'],
      height: CHARACTER_HEIGHT * 1.1,
      clips: [
        { name: 'idle', clip: 'Idle', frames: 4 },
        { name: 'walk', clip: 'Walking_A', frames: 8 },
        { name: 'attack', clip: '1H_Melee_Attack_Chop', frames: 6 },
      ],
    },
  },
  archer: {
    file: CHARACTER_FILES.archer,
    spec: {
      props: PROPS.archer,
      keep: ['2H_Crossbow'],
      height: CHARACTER_HEIGHT,
      clips: [
        { name: 'idle', clip: '2H_Ranged_Aiming', frames: 3 },
        { name: 'walk', clip: 'Walking_B', frames: 8 },
        { name: 'attack', clip: '2H_Ranged_Shoot', frames: 6 },
      ],
    },
  },
  villager: {
    file: CHARACTER_FILES.archer,
    spec: {
      props: PROPS.archer,
      keep: [],
      optional: ['Knife'],
      hide: ['Rogue_Cape'],
      height: CHARACTER_HEIGHT,
      clips: [
        { name: 'idle', clip: 'Idle', frames: 4 },
        { name: 'walk', clip: 'Walking_A', frames: 8 },
        { name: 'work', clip: '1H_Melee_Attack_Chop', frames: 6 },
      ],
    },
  },
};

const DIRT = 0x9a7b52;

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

  async loadAll(onProgress: (ratio: number) => void): Promise<void> {
    const files: string[] = [];
    for (const c of COLORS) {
      for (const names of Object.values(BUILDING_MODELS)) {
        for (const n of names) files.push(`kaykit/building_${n}_${c}.gltf`);
      }
      files.push(`kaykit/flag_${c}.gltf`);
    }
    for (const n of NEUTRAL) files.push(`kaykit/${n}.gltf`);
    for (const n of [...NATURE.trees, ...NATURE.rocks]) files.push(`quaternius/nature/${n}.gltf`);
    const charFiles = Object.values(CHARACTER_FILES);
    const total = files.length + charFiles.length;
    let done = 0;
    const tick = () => onProgress(++done / total);

    await Promise.all([
      ...files.map(async (f) => {
        this.gltfs.set(f, await this.loader.loadAsync(BASE + f));
        tick();
      }),
      ...charFiles.map(async (f) => {
        this.gltfs.set(f, await this.loader.loadAsync(BASE + f));
        tick();
      }),
    ]);
    for (const [kind, { file, spec }] of Object.entries(CROWD_SPECS) as [CrowdModelKind, (typeof CROWD_SPECS)[CrowdModelKind]][]) {
      const gltf = this.require(file);
      this.crowd.set(kind, bakeCharacter(gltf.scene, gltf.animations, spec));
    }
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

  /**
   * Army camp (4x4, no KayKit model): beaten-earth yard, team flags at the corners,
   * a few lumber / stone piles and rocks as decoration. Centered, base at y=0.
   */
  armyCamp(color: KayKitColor, tint?: THREE.Color): THREE.Object3D {
    const root = new THREE.Group();
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 3.8).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: DIRT, roughness: 1 }),
    );
    yard.position.y = 0.015;
    yard.receiveShadow = true;
    root.add(yard);
    for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
      const flag = this.flag(color, tint);
      flag.position.set(x, 0, z);
      root.add(flag);
    }
    const decor: [string, number, number, number, number][] = [
      ['resource_lumber', 0.9, -1.15, 1.25, 0.3],
      ['resource_stone', 0.6, 1.2, -1.2, 1.2],
      ['rock_single_A', 0.35, -1.55, 0.4, 0],
      ['rock_single_C', 0.3, 1.55, 0.6, 0],
      ['rock_single_E', 0.3, 0.2, -1.6, 0],
    ];
    for (const [name, size, x, z, rot] of decor) {
      const o = this.neutral(name, size);
      o.position.set(x, 0, z);
      o.rotation.y = rot;
      root.add(o);
    }
    return root;
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
