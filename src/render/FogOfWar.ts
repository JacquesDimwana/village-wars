import * as THREE from 'three';
import { GAME } from '../core/config';
import type { FogState } from '../core/types';

/** Mask texel values: never explored / explored but out of sight / in vision. */
const UNKNOWN = 0;
const EXPLORED = 128;
const VISIBLE = 255;

/**
 * Shared uniforms: every patched material reads the same mask texture, so one
 * texture upload updates the whole map. rect = (originX, originY, 1/size, 1/size).
 */
const uniforms = {
  fowMask: { value: null as THREE.Texture | null },
  fowRect: { value: new THREE.Vector4(0, 0, 1, 1) },
};

const VERTEX_DECL = /* glsl */ `#include <common>
varying vec2 vFowWorld;`;

const VERTEX_MAIN = /* glsl */ `#include <project_vertex>
vec4 fowPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fowPos = instanceMatrix * fowPos;
#endif
vFowWorld = ( modelMatrix * fowPos ).xz;`;

const FRAGMENT_DECL = /* glsl */ `#include <common>
uniform sampler2D fowMask;
uniform vec4 fowRect;
varying vec2 vFowWorld;`;

/** Unknown = dark slate with a hint of relief; explored = desaturated and dimmed. */
const FRAGMENT_MAIN = /* glsl */ `#include <opaque_fragment>
float fowM = texture2D( fowMask, ( vFowWorld - fowRect.xy ) * fowRect.zw ).r;
float fowL = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
vec3 fowDark = vec3( 0.09, 0.10, 0.13 ) + fowL * 0.10;
vec3 fowGrey = mix( gl_FragColor.rgb, vec3( fowL ), 0.7 ) * 0.58 + vec3( 0.02, 0.03, 0.05 );
vec3 fowOut = mix( fowDark, fowGrey, smoothstep( 0.0, 0.5, fowM ) );
gl_FragColor.rgb = mix( fowOut, gl_FragColor.rgb, smoothstep( 0.5, 1.0, fowM ) );`;

function patchShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.fowMask = uniforms.fowMask;
  shader.uniforms.fowRect = uniforms.fowRect;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', VERTEX_DECL)
    .replace('#include <project_vertex>', VERTEX_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', FRAGMENT_DECL)
    .replace('#include <opaque_fragment>', FRAGMENT_MAIN);
}

const patched = new WeakSet<THREE.Material>();

/** Makes a material darken / grey out according to the fog of war mask (idempotent). */
export function fogMaterial<T extends THREE.Material>(material: T): T {
  if (patched.has(material)) return material;
  patched.add(material);
  material.onBeforeCompile = patchShader;
  return material;
}

/** Patches every mesh material under `root`. */
export function withFog<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material.forEach(fogMaterial);
    else fogMaterial(mesh.material);
  });
  return root;
}

/**
 * Fog of war on the 3D map: a 1-texel-per-tile mask (R8) around the player's town
 * hall, sampled by the patched materials. Linear filtering gives soft edges for free.
 * Rebuilt only when the explored tiles or the current vision change.
 */
export class FogMask {
  private size: number;
  private originX: number;
  private originY: number;
  private data: Uint8Array;
  private texture: THREE.DataTexture;
  private version = -1;
  private visionVersion = -1;

  constructor() {
    this.size = GAME.map.halfSize * 2;
    this.originX = -GAME.map.halfSize;
    this.originY = -GAME.map.halfSize;
    this.data = new Uint8Array(this.size * this.size);
    this.texture = new THREE.DataTexture(this.data, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    uniforms.fowMask.value = this.texture;
    uniforms.fowRect.value.set(this.originX, this.originY, 1 / this.size, 1 / this.size);
  }

  update(fog: FogState): void {
    if (fog.version === this.version && fog.visionVersion === this.visionVersion) return;
    this.version = fog.version;
    this.visionVersion = fog.visionVersion;
    this.rebuild(fog);
    this.texture.needsUpdate = true;
  }

  /** Copies the chunk bitmaps into the mask. Border texels stay UNKNOWN (clamped outside). */
  private rebuild(fog: FogState): void {
    const cs = GAME.chunkSize;
    const n = this.size;
    const data = this.data;
    data.fill(UNKNOWN);
    for (let cy = Math.floor(this.originY / cs); cy <= Math.floor((this.originY + n - 1) / cs); cy++) {
      for (let cx = Math.floor(this.originX / cs); cx <= Math.floor((this.originX + n - 1) / cs); cx++) {
        const key = `${cx},${cy}`;
        const explored = fog.explored[key];
        if (!explored) continue;
        const visible = fog.visible[key];
        for (let ly = 0; ly < cs; ly++) {
          const py = cy * cs + ly - this.originY;
          if (py < 0 || py >= n) continue;
          for (let lx = 0; lx < cs; lx++) {
            const px = cx * cs + lx - this.originX;
            if (px < 0 || px >= n) continue;
            const i = ly * cs + lx;
            data[py * n + px] = visible?.[i] ? VISIBLE : explored[i] ? EXPLORED : UNKNOWN;
          }
        }
      }
    }
  }
}
