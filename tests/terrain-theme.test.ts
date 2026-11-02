import { describe, expect, it } from 'vitest';
import { biomeAt, terrainColor } from '../src/render/Terrain';

describe('terrain visual biomes', () => {
  it('splits the world into three predictable, equally sized kingdoms', () => {
    expect(biomeAt(60, 0)).toBe('solar');
    expect(biomeAt(0, 60)).toBe('wild');
    expect(biomeAt(-60, 0)).toBe('astral');
    expect(biomeAt(0, 0)).toBe('solar');
  });

  it('gives biomes a visible minimap color shift', () => {
    expect(terrainColor('grass', 60, 0)).not.toBe(terrainColor('grass', 0, 60));
    expect(terrainColor('grass', 0, 60)).not.toBe(terrainColor('grass', -60, 0));
  });
});
