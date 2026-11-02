import * as THREE from 'three';

/** Convert FBX material groups to a shared palette texture for the VAT batch. */
export function paletteCharacter(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const colors = new Uint8Array(materials.length * 4);
    materials.forEach((material, i) => {
      const color = (material as THREE.MeshPhongMaterial).color.clone().convertLinearToSRGB();
      colors.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], i * 4);
    });
    const texture = new THREE.DataTexture(colors, materials.length, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const geometry = mesh.geometry;
    const uv = new Float32Array(geometry.attributes.position.count * 2);
    for (const group of geometry.groups) {
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = geometry.index ? geometry.index.getX(i) : i;
        uv[vertex * 2] = ((group.materialIndex ?? 0) + 0.5) / materials.length;
        uv[vertex * 2 + 1] = 0.5;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
  });
}

/** Pack the Ranger's body and bow into one 1024² atlas, keeping one draw call. */
export async function rangerAtlas(root: THREE.Object3D, base: string): Promise<void> {
  const loader = new THREE.TextureLoader();
  const [body, bow] = await Promise.all([
    loader.loadAsync(`${base}Ranger_Texture.png`),
    loader.loadAsync(`${base}Ranger_Bow_Texture.png`),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create Ranger texture atlas');
  ctx.drawImage(body.image, 0, 0, 512, 1024);
  ctx.drawImage(bow.image, 512, 0, 512, 1024);
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9 });
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const uv = mesh.geometry.attributes.uv;
    const shift = mesh.name === 'Ranger_Bow' ? 0.5 : 0;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + shift);
    mesh.material = material;
  });
  body.dispose();
  bow.dispose();
}
