import { describe, expect, it } from 'vitest';
import type { Villager } from '../src/core/types';
import { activeResourceSources, resourceRatio } from '../src/render/ResourceBars';

describe('resource bars', () => {
  it('clamps the remaining fraction and handles an empty capacity', () => {
    expect(resourceRatio(75, 150)).toBe(0.5);
    expect(resourceRatio(-1, 150)).toBe(0);
    expect(resourceRatio(200, 150)).toBe(1);
    expect(resourceRatio(1, 0)).toBe(0);
  });
  it('lists each finite source being worked only once', () => {
    const worker = (task: Villager['task'], harvest: Villager['harvest']): Villager => ({ task, harvest }) as Villager;
    expect(activeResourceSources([
      worker('working', { tx: 1, ty: 2 }),
      worker('working', { tx: 1, ty: 2 }),
      worker('working', { tx: -1, ty: 4, sourceType: 'berry', sourceId: 'b' }),
      worker('working', { tx: 3, ty: 4, sourceType: 'farm' }),
      worker('returning', { tx: 5, ty: 6 }),
      worker('working', null),
    ])).toEqual([{ tx: 1, ty: 2 }, { tx: -1, ty: 4 }]);
  });
});
