import * as THREE from 'three';

/** Preserve FBX material colors per face, including vertices shared by material groups. */
export function paletteCharacter(root: THREE.Object3D, palette: Record<string, number> = {}): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // A shared indexed vertex can belong to faces with different materials.
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    mesh.geometry = geometry;
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(1);
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0] as THREE.MeshPhongMaterial | undefined;
      const override = material && palette[material.name];
      const color = override === undefined ? material?.color ?? new THREE.Color(0xffffff) : new THREE.Color(override);
      for (let i = group.start; i < group.start + group.count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
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
