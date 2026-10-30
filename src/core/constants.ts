export const TILE_SIZE = 32;
export const PLAYER_ID = 'player';

export const tileToPx = (t: number): number => t * TILE_SIZE;
export const pxToTile = (px: number): number => Math.floor(px / TILE_SIZE);
