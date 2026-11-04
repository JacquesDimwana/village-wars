import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshPart } from './Assets';

/** A shared cutout atlas per species, painted with the original foliage and bark textures. */
export function treeCards(parts: MeshPart[], pine: boolean): { levels: THREE.BufferGeometry[]; material: THREE.MeshStandardMaterial } {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const leaf = parts.find(p => p.material.name.includes('Leaves')) ?? parts[1];
  const bark = parts.find(p => p.material.name.includes('Bark')) ?? parts[0];
  const leafMap = (leaf.material as THREE.MeshStandardMaterial).map;
  const barkMap = (bark.material as THREE.MeshStandardMaterial).map;
  // Rounded, overlapping lobes make a soft silhouette without decimated triangles.
  ctx.save(); ctx.beginPath();
  if (pine) {
    ctx.moveTo(128, 8); ctx.lineTo(83, 80); ctx.lineTo(99, 78);
    ctx.lineTo(49, 145); ctx.lineTo(72, 140); ctx.lineTo(17, 220);
    ctx.quadraticCurveTo(128, 250, 239, 220); ctx.lineTo(184, 140);
    ctx.lineTo(207, 145); ctx.lineTo(157, 78); ctx.lineTo(173, 80); ctx.closePath();
  } else {
    ctx.moveTo(18, 168); ctx.bezierCurveTo(0, 134, 17, 98, 45, 95);
    ctx.bezierCurveTo(38, 61, 69, 41, 91, 52); ctx.bezierCurveTo(102, 13, 149, 13, 163, 48);
    ctx.bezierCurveTo(196, 34, 222, 63, 215, 96); ctx.bezierCurveTo(250, 104, 253, 145, 236, 169);
    ctx.bezierCurveTo(245, 204, 211, 226, 185, 218); ctx.bezierCurveTo(157, 243, 119, 238, 103, 222);
    ctx.bezierCurveTo(67, 237, 36, 216, 37, 200); ctx.bezierCurveTo(18, 199, 10, 185, 18, 168); ctx.closePath();
  }
  ctx.clip();
  if (leafMap) ctx.drawImage(leafMap.image as CanvasImageSource, 0, 0, 256, 256);
  else { ctx.fillStyle = '#426c38'; ctx.fillRect(0, 0, 256, 256); }
  ctx.restore();
  if (barkMap) ctx.drawImage(barkMap.image as CanvasImageSource, 256, 0, 256, 256);
  else { ctx.fillStyle = '#795639'; ctx.fillRect(256, 0, 256, 256); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.35, emissive: 0x18300f, emissiveIntensity: 0.35 });
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
  const height = box.max.y - box.min.y;
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const levels = [8, 4, 2].map((cards, lod) => {
    const geometries: THREE.BufferGeometry[] = [];
    if (lod < 2) {
      const trunk = new THREE.CylinderGeometry(width * 0.055, width * 0.075, height * 0.48, 5, 1, true).toNonIndexed();
      trunk.translate(0, height * 0.24, 0);
      const uv = trunk.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.5, uv.getY(i));
      geometries.push(trunk);
    }
    if (lod === 2) {
      const trunk = new THREE.PlaneGeometry(width * 0.12, height * 0.48).toNonIndexed();
      trunk.translate(0, height * 0.24, 0);
      const uv = trunk.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5 + uv.getX(i) * 0.5);
      geometries.push(trunk);
    }
    for (let i = 0; i < cards; i++) {
      const card = new THREE.PlaneGeometry(width * (pine ? 0.9 : 0.8), height * (pine ? 0.85 : 0.65)).toNonIndexed();
      const uv = card.getAttribute('uv');
      for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * 0.5);
      card.translate(0, height * (pine ? 0.56 : 0.67), 0);
      card.rotateY(i * Math.PI / cards);
      const pos = card.getAttribute('position'), normal = card.getAttribute('normal');
      for (let j = 0; j < pos.count; j++) {
        const n = new THREE.Vector3(pos.getX(j), (pos.getY(j) - height * 0.55) * 0.8, pos.getZ(j)).normalize();
        normal.setXYZ(j, n.x, n.y, n.z);
      }
      geometries.push(card);
    }
    const merged = mergeGeometries(geometries)!;
    geometries.forEach(g => g.dispose());
    return merged;
  });
  return { levels, material };
}
