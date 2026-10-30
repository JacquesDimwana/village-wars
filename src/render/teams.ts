import * as THREE from 'three';

/** KayKit buildings exist in 4 team colors; extra villages reuse one with a material tint. */
export type KayKitColor = 'blue' | 'red' | 'green' | 'yellow';

export interface TeamStyle {
  kaykit: KayKitColor;
  /** Multiplied into the materials (white = unchanged). */
  tint: THREE.Color;
  /** Color of rings, banners and HUD markers. Matches Village.color. */
  marker: THREE.Color;
}

const STYLES: Record<string, TeamStyle> = {
  player: { kaykit: 'blue', tint: new THREE.Color(0xffffff), marker: new THREE.Color(0x3498db) },
  'ai-1': { kaykit: 'red', tint: new THREE.Color(0xffffff), marker: new THREE.Color(0xd94b3d) },
  'ai-2': { kaykit: 'green', tint: new THREE.Color(0xffffff), marker: new THREE.Color(0x4caf50) },
  'ai-3': { kaykit: 'yellow', tint: new THREE.Color(0xffffff), marker: new THREE.Color(0xf2c230) },
  'ai-4': { kaykit: 'red', tint: new THREE.Color(0.75, 0.55, 1.0), marker: new THREE.Color(0x9b59b6) },
  'ai-5': { kaykit: 'green', tint: new THREE.Color(0.55, 1.0, 1.0), marker: new THREE.Color(0x1abc9c) },
};

export function teamStyle(villageId: string): TeamStyle {
  return STYLES[villageId] ?? STYLES['ai-1'];
}
