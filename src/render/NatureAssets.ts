import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshPart } from './Assets';
import { simplifyStatic } from './TerrainLod';

/** One atlas and material for the four Quaternius nature textures. */
export function natureMaterial(parts: MeshPart[][]): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create nature atlas');
  const slots: Record<string, [number, number]> = {
    Bark_NormalTree: [0, 0], Leaves_NormalTree: [1, 0], Leaves_Pine: [0, 1], Rocks: [1, 1],
  };
  for (const part of parts.flat()) {
    const mat = part.material as THREE.MeshStandardMaterial;
    const slot = slots[mat.name];
    if (slot && mat.map) ctx.drawImage(mat.map.image as CanvasImageSource, slot[0] * 512, slot[1] * 512, 512, 512);
  }
  // Solid swatches for the low-poly canopy and trunk, plus iron veins.
  for (const [x, color] of [[1008, '#426c38'], [1012, '#315b3a'], [1016, '#795639']] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(x, 1020, 4, 4);
  }
  ctx.fillStyle = '#e6d9bc';
  ctx.fillRect(1020, 1020, 4, 4);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false;
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, roughness: 1, emissive: 0x18300f, emissiveIntensity: 0.35, side: THREE.DoubleSide, alphaTest: 0.05 });
}

/** Normalize atlas UVs, cluster the tree geometry, and combine its material parts. */
export function prepareNature(parts: MeshPart[], material: THREE.Material, tree: boolean): MeshPart[] {
  const slots: Record<string, [number, number]> = {
    Bark_NormalTree: [0, 0], Leaves_NormalTree: [1, 0], Leaves_Pine: [0, 1], Rocks: [1, 1],
  };
  const build = (cell: number): THREE.BufferGeometry => {
    const geometries = parts.map((part) => {
      const g = simplifyStatic(part.geometry, cell);
      const uv = g.getAttribute('uv');
      const [x, y] = slots[part.material.name];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + x) / 2, (uv.getY(i) + y) / 2);
      return g;
    });
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!merged) throw new Error('Could not merge nature geometry');
    return merged;
  };
  if (tree) return [{ geometry: build(0.045), material }];
  let cell = 0.02;
  let geometry = build(cell);
  while (geometry.getAttribute('position').count / 3 > 150 && cell < 1) {
    geometry.dispose();
    geometry = build(cell *= 1.3);
  }
  if (geometry.getAttribute('position').count / 3 > 150) {
    // Bound the remaining rock geometry while retaining triangles across the source.
    const source = geometry;
    const count = source.getAttribute('position').count;
    const reduced = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attr = source.getAttribute(name);
      const values: number[] = [];
      for (let i = 0; i < 150; i++) {
        const start = Math.floor(i * (count / 3) / 150) * 3;
        for (let v = start; v < start + 3; v++) {
          for (let component = 0; component < attr.itemSize; component++) values.push(attr.getComponent(v, component));
        }
      }
      reduced.setAttribute(name, new THREE.Float32BufferAttribute(values, attr.itemSize));
    }
    geometry = reduced;
    source.dispose();
  }
  return [{ geometry, material }];
}

/** Project three angular pale strips onto the rock's upper surface. */
export function oreVeins(rock: THREE.BufferGeometry): THREE.BufferGeometry {
  const mesh = new THREE.Mesh(rock, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const pos: number[] = [];
  const uv: number[] = [];
  for (const z of [-0.04, 0, 0.04]) {
    const points = [[-0.07, z - 0.01], [0.07, z + 0.005], [0.06, z + 0.02], [-0.06, z + 0.005]];
    const projected = points.map(([x, y]) => {
      ray.set(new THREE.Vector3(x, 2, y), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      return hit ? hit.point.add(new THREE.Vector3(0, 0.008, 0)) : null;
    });
    if (projected.some((p) => !p)) continue;
    for (const i of [0, 2, 1, 0, 3, 2]) {
      const p = projected[i]!;
      pos.push(p.x, p.y, p.z);
      uv.push(0.998, 0.998);
    }
  }
  mesh.material.dispose();
  const veins = new THREE.BufferGeometry();
  veins.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  veins.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  veins.computeVertexNormals();
  const merged = mergeGeometries([rock, veins]);
  veins.dispose();
  return merged ?? rock.clone();
}
