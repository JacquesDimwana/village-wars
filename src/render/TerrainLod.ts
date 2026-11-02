import * as THREE from 'three';

/**
 * Helpers for the far terrain levels of detail (strategic view, GDD §7):
 * simplified nature models merged into one mesh per chunk (1 draw call).
 */

/** UV quantization of the clustering (keeps the palette colors of the atlas apart). */
const UV_STEPS = 8;

/**
 * Vertex-clustering simplification of a static model: vertices in the same `cell`
 * (and same palette area) collapse to one, degenerate triangles are dropped.
 * Returns a non-indexed geometry with flat normals (keeps the low-poly look).
 */
export function simplifyStatic(source: THREE.BufferGeometry, cell: number): THREE.BufferGeometry {
  const pos = source.attributes.position;
  const uv = source.attributes.uv;
  const n = pos.count;
  const index = source.index ? Array.from(source.index.array) : [...Array(n).keys()];
  const reps = new Map<string, number>();
  const remap = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const key = [
      Math.floor(pos.getX(i) / cell),
      Math.floor(pos.getY(i) / cell),
      Math.floor(pos.getZ(i) / cell),
      uv ? Math.floor(uv.getX(i) * UV_STEPS) : 0,
      uv ? Math.floor(uv.getY(i) * UV_STEPS) : 0,
    ].join(',');
    let r = reps.get(key);
    if (r === undefined) reps.set(key, (r = i));
    remap[i] = r;
  }
  const outPos: number[] = [];
  const outUv: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const tri = [remap[index[t]], remap[index[t + 1]], remap[index[t + 2]]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (const v of tri) {
      outPos.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      outUv.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  g.computeVertexNormals();
  return g;
}

export interface MergeEntry {
  /** Non-indexed geometry (position, normal, uv). */
  geometry: THREE.BufferGeometry;
  matrices: THREE.Matrix4[];
  color: THREE.Color;
}

/** Bakes many placed copies into one non-indexed geometry with a per-vertex color (tint). */
export function mergePlaced(entries: MergeEntry[]): THREE.BufferGeometry | null {
  let total = 0;
  for (const e of entries) total += e.geometry.attributes.position.count * e.matrices.length;
  if (total === 0) return null;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let o = 0;
  for (const e of entries) {
    const gp = e.geometry.attributes.position;
    const gn = e.geometry.attributes.normal;
    const gu = e.geometry.attributes.uv;
    for (const m of e.matrices) {
      nm.getNormalMatrix(m);
      for (let i = 0; i < gp.count; i++, o++) {
        v.fromBufferAttribute(gp, i).applyMatrix4(m);
        pos.set([v.x, v.y, v.z], o * 3);
        v.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
        nrm.set([v.x, v.y, v.z], o * 3);
        uv.set([gu.getX(i), gu.getY(i)], o * 2);
        col.set([e.color.r, e.color.g, e.color.b], o * 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
