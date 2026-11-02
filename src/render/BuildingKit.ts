import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType } from '../core/types';

export const KIT_PARTS = [
  'Wall_Plaster_Straight', 'Wall_Plaster_Door_Flat', 'Wall_Plaster_Window_Wide_Flat',
  'Wall_UnevenBrick_Straight', 'Roof_RoundTiles_4x4', 'Door_1_Flat', 'Prop_Chimney',
  'Prop_Crate', 'Prop_WoodenFence_Single', 'Prop_Support', 'Floor_WoodDark', 'Prop_Brick1',
] as const;
type Part = typeof KIT_PARTS[number];
type Placement = [Part, number, number, number, number?, number?, number?, number?];
type KitType = Exclude<BuildingType, 'townHall'>;
const P = Math.PI;

// Pieces use the kit's original two-unit wall grid. The finished assembly is fitted below.
function house(brick = false): Placement[] {
  return [
    ['Wall_Plaster_Door_Flat', 0, 0, 1],
    ['Wall_Plaster_Window_Wide_Flat', 0, 0, -1, P],
    [brick ? 'Wall_UnevenBrick_Straight' : 'Wall_Plaster_Straight', -1, 0, 0, -P / 2],
    ['Wall_Plaster_Straight', 1, 0, 0, P / 2],
    ['Door_1_Flat', -0.5, 0, 1.04],
    ['Roof_RoundTiles_4x4', 0, 3, 0, 0, 0.43, 0.43, 0.43],
  ];
}
const fence: Placement[] = [
  ['Prop_WoodenFence_Single', -1, 0, 1.8], ['Prop_WoodenFence_Single', 1, 0, 1.8],
];
function layout(type: KitType, variant: number): Placement[] {
  switch (type) {
    case 'house': return house(variant % 2 === 1);
    case 'lumberCamp': return [
      ['Floor_WoodDark', 0, 0, 0], ['Prop_Support', -0.9, 0, -0.8], ['Prop_Support', 0.9, 0, -0.8],
      ['Roof_RoundTiles_4x4', 0, 2.6, 0, 0, 0.45, 0.3, 0.45],
      ['Prop_Crate', 0.8, 0, 1.1], ['Prop_WoodenFence_Single', -0.7, 0, 1.1],
    ];
    case 'minerCamp': return [...fence, ['Prop_Support', 0, 0, -0.7],
      ['Prop_Brick1', -0.6, 0.25, 0], ['Prop_Brick1', 0, 0.25, 0], ['Prop_Brick1', 0.6, 0.25, 0],
      ['Prop_Crate', 0.7, 0, -0.9]];
    case 'mill': return [
      ['Wall_UnevenBrick_Straight', 0, 0, -0.8], ['Wall_Plaster_Door_Flat', 0, 0, 0.9],
      ['Wall_UnevenBrick_Straight', -1, 0, 0, -P / 2], ['Wall_UnevenBrick_Straight', 1, 0, 0, P / 2],
      ['Roof_RoundTiles_4x4', 0, 3, 0, 0, 0.43, 0.3, 0.43], ['Prop_Crate', 1.2, 0, 1.1],
    ];
    case 'farm': return [['Floor_WoodDark', 0, 0, 0], ...fence, ['Prop_WoodenFence_Single', -1, 0, -1.8], ['Prop_WoodenFence_Single', 1, 0, -1.8]];
    case 'armory': return [...house(true), ['Prop_Crate', 1.15, 0, 1], ['Prop_WoodenFence_Single', -0.5, 0, 1.6]];
    case 'barracks': return [...house(true), ...fence, ['Prop_Crate', 1.4, 0, 0.8]];
    case 'armyCamp': return [
      ['Floor_WoodDark', 0, 0, 0], ...fence,
      ['Prop_WoodenFence_Single', -1, 0, -1.8], ['Prop_WoodenFence_Single', 1, 0, -1.8],
      ['Prop_Crate', -0.9, 0, -0.7], ['Prop_Support', 0.8, 0, -0.8],
    ];
    case 'tower': return [
      ['Wall_UnevenBrick_Straight', 0, 0, 1], ['Wall_UnevenBrick_Straight', 0, 0, -1, P],
      ['Wall_UnevenBrick_Straight', -1, 0, 0, -P / 2], ['Wall_UnevenBrick_Straight', 1, 0, 0, P / 2],
      ['Floor_WoodDark', 0, 3, 0], ['Prop_WoodenFence_Single', 0, 3, 1],
    ];
  }
}

const atlasSlots: Record<string, number> = {
  MI_WoodTrim: 0, MI_Plaster: 1, MI_Brick: 2, MI_UnevenBrick: 3,
  MI_RockTrim: 4, MI_RoundTiles: 5,
};

/** Builds and caches one atlas-backed mesh per silhouette; only the banner varies by team. */
export class BuildingKit {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private readonly material: THREE.MeshStandardMaterial;
  constructor(private readonly getPart: (name: Part) => THREE.Object3D, atlas: THREE.Texture) {
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.flipY = false;
    this.material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 1 });
  }

  create(type: KitType, variant: number, footprint: number, marker: THREE.Color): THREE.Object3D {
    const key = `${type}:${type === 'house' ? variant % 2 : 0}`;
    let geometry = this.cache.get(key);
    if (!geometry) {
      geometry = this.compose(layout(type, variant), type);
      this.cache.set(key, geometry);
    }
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
    // A compact team-colored pennant is kept separate from the shared building atlas.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const bannerWidth = Math.min(0.22, size.x * 0.4);
    const bannerHeight = Math.min(0.27, size.y * 0.3);
    const bannerDepth = Math.min(0.025, size.z);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(bannerWidth, bannerHeight, bannerDepth), new THREE.MeshStandardMaterial({ color: marker, roughness: 1 }));
    banner.position.set(0, size.y * 0.7, box.max.z - bannerDepth / 2);
    root.add(banner);
    root.scale.setScalar(Math.max(0, footprint - 0.1));
    return root;
  }

  private compose(placements: Placement[], type: KitType): THREE.BufferGeometry {
    const pieces: THREE.BufferGeometry[] = [];
    for (const [name, x, y, z, rotation = 0, sx = 1, sy = 1, sz = 1] of placements) {
      const part = this.getPart(name);
      part.updateMatrixWorld(true);
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(sx, sy, sz));
      part.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        const slot = atlasSlots[(object.material as THREE.Material).name] ?? 0;
        const uv = source.getAttribute('uv');
        if (uv) for (let i = 0; i < uv.count; i++) {
          const u = THREE.MathUtils.clamp(uv.getX(i), 0.002, 0.998);
          const v = THREE.MathUtils.clamp(uv.getY(i), 0.002, 0.998);
          uv.setXY(i, (slot % 4 + u) / 4, (Math.floor(slot / 4) + v) / 4);
        }
        for (const attr of Object.keys(source.attributes)) if (!['position', 'normal', 'uv'].includes(attr)) source.deleteAttribute(attr);
        source.applyMatrix4(object.matrixWorld).applyMatrix4(transform);
        pieces.push(source);
      });
    }
    if (type === 'minerCamp' || type === 'lumberCamp') {
      const addDetail = (geometry: THREE.BufferGeometry, slot: number) => {
        const detail = geometry.toNonIndexed();
        geometry.dispose();
        const uv = detail.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, (slot % 4 + uv.getX(i) * 0.99) / 4, (Math.floor(slot / 4) + uv.getY(i) * 0.99) / 4);
        }
        pieces.push(detail);
      };
      if (type === 'minerCamp') {
        const opening = new THREE.PlaneGeometry(0.9, 1.8);
        opening.translate(0, 0.9, 0.85);
        addDetail(opening, 6);
      } else {
        for (let i = 0; i < 3; i++) {
          const log = new THREE.CylinderGeometry(0.17, 0.17, 1.3, 8);
          log.rotateZ(Math.PI / 2);
          log.translate(-0.3, 0.17 + (i === 2 ? 0.28 : 0), 1.05 + (i === 1 ? 0.35 : 0));
          addDetail(log, 0);
        }
      }
    }
    const merged = mergeGeometries(pieces);
    if (!merged) throw new Error('Could not merge building kit geometry');
    for (const piece of pieces) piece.dispose();
    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    // Fit both the ground footprint and the height, preserving each kit's proportions.
    const widthLimit = type === 'tower' ? 0.65 : 1;
    const heightLimit = type === 'tower' ? 1.2 : 0.9;
    const scale = Math.min(widthLimit / Math.max(size.x, size.z, 0.001), heightLimit / Math.max(size.y, 0.001));
    const center = box.getCenter(new THREE.Vector3());
    merged.translate(-center.x, -box.min.y, -center.z);
    merged.scale(scale, scale, scale);
    return merged;
  }
}
