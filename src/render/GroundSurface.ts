import * as THREE from 'three';
import type { WorldGen } from '../world/WorldGen';
import type { TileType } from '../core/types';

/** Interpolated tile-centred weights; continuous across chunk boundaries. */
export function groundWeights(x: number, z: number, tile: (x: number, z: number) => TileType): number[] {
  const ix = Math.floor(x - 0.5), iz = Math.floor(z - 0.5);
  const fx = x - 0.5 - ix, fz = z - 0.5 - iz;
  const weights = [0, 0, 0, 0, 0, 0];
  const types: TileType[] = ['grass', 'forest', 'sand', 'rock', 'iron', 'water'];
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
    weights[types.indexOf(tile(ix + dx, iz + dz))] += (dx ? fx : 1 - fx) * (dz ? fz : 1 - fz);
  }
  return weights;
}

export function groundHeight(world: WorldGen, x: number, z: number): number {
  const w = groundWeights(x, z, (tx, tz) => world.getTile(tx, tz));
  return world.visualHeight(x, z) - w[5] * 0.48 + (w[3] + w[4]) * 0.035;
}

const loader = new THREE.TextureLoader();
function texture(name: string, color: boolean): THREE.Texture {
  const t = loader.load(`${import.meta.env.BASE_URL}models/polyhaven/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lit standard material with photographic terrain splatting in world coordinates. */
export function groundMaterial(): THREE.MeshStandardMaterial {
  const maps = ['aerial_grass_rock', 'forest_ground_04', 'coast_sand_01', 'aerial_rocks_02', 'brown_mud_leaves_01'].map(n => texture(`${n}_diff`, true));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, normalMap: texture('aerial_grass_rock_nor_gl', false), normalScale: new THREE.Vector2(0.18, 0.18) });
  mat.onBeforeCompile = shader => {
    maps.forEach((map, i) => { shader.uniforms[`groundMap${i}`] = { value: map }; });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 splat; attribute float oreWeight; varying vec4 vSplat; varying float vOre; varying vec2 vGround;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat=splat; vOre=oreWeight; vGround=(modelMatrix * vec4(position,1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D groundMap0; uniform sampler2D groundMap1; uniform sampler2D groundMap2; uniform sampler2D groundMap3; uniform sampler2D groundMap4;
      varying vec4 vSplat; varying float vOre; varying vec2 vGround;
      float gn(vec2 p) { return fract(sin(dot(p,vec2  (127.1,311.7)))*43758.5453); }
      vec4 sampleGround(sampler2D tex, vec2 p, float n) { return mix(texture2D(tex,p*0.28),texture2D(tex,p*0.071+vec2(0.37,0.13)),0.35+n*0.15); }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float noise = gn(floor(vGround*3.0));
      vec4 w = max(vSplat + (noise-0.5)*0.10, 0.0); w /= max(dot(w,vec4(1.0)),0.001);
      vec3 albedo = sampleGround(groundMap0,vGround,noise).rgb*vec3(0.85,1.35,0.72)*w.x + mix(sampleGround(groundMap0,vGround,noise).rgb*vec3(0.80,1.28,0.68), sampleGround(groundMap1,vGround,noise).rgb, 0.22)*w.y + sampleGround(groundMap2,vGround,noise).rgb*w.z + sampleGround(groundMap3,vGround,noise).rgb*w.w;
      albedo = mix(albedo, sampleGround(groundMap4,vGround,noise).rgb*0.58, vOre * smoothstep(0.38,0.65,gn(floor(vGround*5.0))));
      diffuseColor.rgb *= albedo * mix(0.88,1.08,noise);`);
  };
  return mat;
}
