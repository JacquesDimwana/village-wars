import * as THREE from 'three';

/**
 * Vertex Animation Textures (VAT): a skinned character is "baked" once at load
 * time into ONE static geometry + float textures holding the skinned position/normal of
 * every vertex for a few sampled frames of each clip. A single InstancedMesh then draws
 * a whole crowd (1 draw call + 1 shadow call per model), the vertex shader reading the
 * animated vertex with texelFetch(gl_VertexID).
 */

export type CrowdClip = 'idle' | 'walk' | 'carry' | 'work' | 'attack';

export interface BakeSpec {
  /** Prop meshes (children of hand slots) that stay visible. */
  keep: string[];
  /** Prop meshes baked in but only shown on instances whose "show prop" flag is on. */
  optional?: string[];
  /** Meshes left out entirely (props not in keep/optional are dropped as well). */
  hide?: string[];
  /** Every prop mesh of the rig (anything listed here and not kept is dropped). */
  props: string[];
  /** Final height in tiles (world units). */
  height: number;
  /** First clip is used for the bind frame and to measure the height. */
  clips: { name: CrowdClip; clip: string; frames: number }[];
}

export interface VatClip {
  /** First frame index in the texture. */
  start: number;
  frames: number;
  duration: number;
}

export interface VatModel {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  clips: Partial<Record<CrowdClip, VatClip>>;
  vertexCount: number;
  /** Index buffers per level of detail: [full, simplified, very far]. Swap with geometry.setIndex. */
  lods: THREE.BufferAttribute[];
}

/** Cluster cell of each simplified LOD, as a fraction of the character height. */
const LOD_CELLS = [0.09, 0.15];
/** UV quantization of the LOD clustering (keeps palette colors from bleeding). */
const LOD_UV_STEPS = 8;

const MAX_WIDTH = 2048;

interface Part {
  mesh: THREE.Mesh;
  skinned: boolean;
  optional: boolean;
}

export function bakeCharacter(scene: THREE.Object3D, animations: THREE.AnimationClip[], spec: BakeSpec): VatModel {
  const keep = new Set(spec.keep);
  const optional = new Set(spec.optional ?? []);
  const hide = new Set(spec.hide ?? []);
  const props = new Set(spec.props);
  const parts: Part[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || hide.has(o.name)) return;
    if (props.has(o.name) && !keep.has(o.name) && !optional.has(o.name)) return;
    parts.push({ mesh, skinned: (o as THREE.SkinnedMesh).isSkinnedMesh === true, optional: optional.has(o.name) });
  });
  const vertexCount = parts.reduce((s, p) => s + p.mesh.geometry.attributes.position.count, 0);
  const totalFrames = spec.clips.reduce((s, c) => s + c.frames, 0);

  // --- Static attributes (uv, index, optional-prop mask) ---
  const uv = new Float32Array(vertexCount * 2);
  const mask = new Float32Array(vertexCount);
  const indices: number[] = [];
  const partOf = new Uint16Array(vertexCount);
  let offset = 0;
  for (const [pi, p] of parts.entries()) {
    const g = p.mesh.geometry;
    const n = g.attributes.position.count;
    const guv = g.attributes.uv;
    if (guv) for (let i = 0; i < n; i++) (uv[(offset + i) * 2] = guv.getX(i)), (uv[(offset + i) * 2 + 1] = guv.getY(i));
    if (p.optional) mask.fill(1, offset, offset + n);
    partOf.fill(pi, offset, offset + n);
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset);
    else for (let i = 0; i < n; i++) indices.push(i + offset);
    offset += n;
  }

  // --- Animated frames ---
  const pos = new Float32Array(totalFrames * vertexCount * 3);
  const nrm = new Float32Array(totalFrames * vertexCount * 3);
  const mixer = new THREE.AnimationMixer(scene);
  const clips: Partial<Record<CrowdClip, VatClip>> = {};
  const mats: THREE.Matrix4[] = [];
  const tmp = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let frame = 0;
  for (const c of spec.clips) {
    const clip = THREE.AnimationClip.findByName(animations, c.clip);
    if (!clip) throw new Error(`Missing clip ${c.clip}`);
    clips[c.name] = { start: frame, frames: c.frames, duration: clip.duration };
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    for (let f = 0; f < c.frames; f++, frame++) {
      mixer.setTime((f * clip.duration) / c.frames);
      scene.updateMatrixWorld(true);
      let base = frame * vertexCount;
      for (const p of parts) {
        const g = p.mesh.geometry;
        const gp = g.attributes.position;
        const gn = g.attributes.normal;
        const sw = g.attributes.skinWeight;
        const si = g.attributes.skinIndex;
        if (p.skinned) {
          const sm = p.mesh as THREE.SkinnedMesh;
          const bones = sm.skeleton.bones;
          for (let b = 0; b < bones.length; b++) {
            mats[b] ??= new THREE.Matrix4();
            mats[b]
              .multiplyMatrices(sm.matrixWorld, sm.bindMatrixInverse)
              .multiply(tmp.multiplyMatrices(bones[b].matrixWorld, sm.skeleton.boneInverses[b]))
              .multiply(sm.bindMatrix);
          }
        } else {
          nm.getNormalMatrix(p.mesh.matrixWorld);
        }
        for (let i = 0; i < gp.count; i++) {
          v.fromBufferAttribute(gp, i);
          nv.fromBufferAttribute(gn, i);
          if (p.skinned) {
            acc.set(0, 0, 0);
            accN.set(0, 0, 0);
            for (let k = 0; k < 4; k++) {
              const w = sw.getComponent(i, k);
              if (w === 0) continue;
              const m = mats[si.getComponent(i, k)];
              acc.addScaledVector(sv.copy(v).applyMatrix4(m), w);
              accN.addScaledVector(sv.copy(nv).transformDirection(m), w);
            }
            v.copy(acc);
            nv.copy(accN).normalize();
          } else {
            v.applyMatrix4(p.mesh.matrixWorld);
            nv.applyMatrix3(nm).normalize();
          }
          const o = (base + i) * 3;
          pos[o] = v.x;
          pos[o + 1] = v.y;
          pos[o + 2] = v.z;
          nrm[o] = nv.x;
          nrm[o + 1] = nv.y;
          nrm[o + 2] = nv.z;
        }
        base += gp.count;
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // Normalize: feet at y=0 and `spec.height` tall, measured on the first frame.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    if (mask[i] > 0) continue;
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  const s = spec.height / Math.max(maxY - minY, 0.001);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= s;
    pos[i + 1] = (pos[i + 1] - minY) * s;
    pos[i + 2] *= s;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, vertexCount * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(0, vertexCount * 3), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('vatMask', new THREE.BufferAttribute(mask, 1));
  let full = new THREE.BufferAttribute(new Uint32Array(indices), 1);
  for (let cell = 0.02; full.count > 6000 && cell <= 0.14; cell += 0.01) {
    full = simplify(indices, pos, uv, partOf, spec.height * cell);
  }
  const lods = [full, ...LOD_CELLS.map((c) => simplify(Array.from(full.array), pos, uv, partOf, spec.height * c))];
  geometry.setIndex(full);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, spec.height / 2, 0), spec.height * 2);

  const texels = totalFrames * vertexCount;
  const width = Math.min(MAX_WIDTH, texels);
  const posTex = floatTexture(pos, texels, width);
  const nrmTex = floatTexture(nrm, texels, width);
  const source = parts[0].mesh.material as THREE.MeshStandardMaterial;
  const uniforms = {
    vatPos: { value: posTex },
    vatNrm: { value: nrmTex },
    vatVerts: { value: vertexCount },
    vatWidth: { value: width },
  };
  const material = source.clone();
  patchVat(material, uniforms);
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchVat(depthMaterial, uniforms);
  return { geometry, material, depthMaterial, clips, vertexCount, lods };
}

/**
 * Vertex-clustering LOD that keeps the VAT mapping: every vertex is replaced by the
 * first original vertex of its cell (same mesh part, same palette area), so the
 * animation texture is still indexed by gl_VertexID. Degenerate triangles are dropped.
 */
function simplify(indices: number[], pos: Float32Array, uv: Float32Array, partOf: Uint16Array, cell: number): THREE.BufferAttribute {
  const reps = new Map<string, number>();
  const remap = new Uint32Array(partOf.length);
  for (let i = 0; i < partOf.length; i++) {
    const key = [
      partOf[i],
      Math.floor(pos[i * 3] / cell),
      Math.floor(pos[i * 3 + 1] / cell),
      Math.floor(pos[i * 3 + 2] / cell),
      Math.floor(uv[i * 2] * LOD_UV_STEPS),
      Math.floor(uv[i * 2 + 1] * LOD_UV_STEPS),
    ].join(',');
    let r = reps.get(key);
    if (r === undefined) reps.set(key, (r = i));
    remap[i] = r;
  }
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return new THREE.BufferAttribute(new Uint32Array(out), 1);
}

/** RGBA float texture, texel i = vertex (frame * vertexCount + vertexId), folded in rows of `width`. */
function floatTexture(xyz: Float32Array, texels: number, width: number): THREE.DataTexture {
  const height = Math.ceil(texels / width);
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < texels; i++) {
    data[i * 4] = xyz[i * 3];
    data[i * 4 + 1] = xyz[i * 3 + 1];
    data[i * 4 + 2] = xyz[i * 3 + 2];
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const VAT_PARS = /* glsl */ `
uniform sampler2D vatPos;
uniform sampler2D vatNrm;
uniform int vatVerts;
uniform int vatWidth;
// x = first frame of the clip, y = frame count, z = frame position (fractional), w = show optional prop
attribute vec4 vatAnim;
attribute float vatMask;
ivec2 vatUv(float frame) {
  int i = int(frame + 0.5) * vatVerts + gl_VertexID;
  return ivec2(i % vatWidth, i / vatWidth);
}
vec3 vatSample(bool normalTex) {
  float f = floor(vatAnim.z);
  float f1 = mod(f + 1.0, vatAnim.y);
  ivec2 a = vatUv(vatAnim.x + f);
  ivec2 b = vatUv(vatAnim.x + f1);
  vec3 va = normalTex ? texelFetch(vatNrm, a, 0).xyz : texelFetch(vatPos, a, 0).xyz;
  vec3 vb = normalTex ? texelFetch(vatNrm, b, 0).xyz : texelFetch(vatPos, b, 0).xyz;
  return mix(va, vb, vatAnim.z - f);
}
`;

function patchVat(material: THREE.Material, uniforms: Record<string, THREE.IUniform>): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_PARS}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vatSample(true));')
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = (vatMask > 0.5 && vatAnim.w < 0.5) ? vec3(0.0) : vatSample(false);',
      );
  };
  material.customProgramCacheKey = () => 'vat';
}
