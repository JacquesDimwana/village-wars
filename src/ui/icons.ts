import type { BuildingType, Cost, ResourceType, UnitType, Village, WeaponType } from '../core/types';

/**
 * Recolorable game icon (game-icons.net, CC BY 3.0 — see the credits screen).
 * The SVG is used as a CSS mask, so the icon takes the text color.
 */
export const gi = (name: string, cls = ''): string =>
  `<i class="gi${cls ? ` ${cls}` : ''}" style="--gi:url(ui/icons/${name}.svg)" aria-hidden="true"></i>`;

/** `some` = French partitive ("du bois", "de la pierre"). */
export const RESOURCE_UI: { key: ResourceType; icon: string; label: string; some: string }[] = [
  { key: 'wood', icon: gi('wood', 'c-wood'), label: 'Bois', some: 'du bois' },
  { key: 'stone', icon: gi('stone', 'c-stone'), label: 'Pierre', some: 'de la pierre' },
  { key: 'ore', icon: gi('ore', 'c-ore'), label: 'Minerai', some: 'du minerai' },
  { key: 'iron', icon: gi('iron', 'c-iron'), label: 'Fer', some: 'du fer' },
];

export const BUILDING_UI: Record<BuildingType, { icon: string; desc: string }> = {
  townHall: { icon: gi('castle'), desc: 'Cœur du village. Détruit = défaite.' },
  house: { icon: gi('house'), desc: '+10 places pour de nouveaux habitants.' },
  lumberCamp: { icon: gi('lumberCamp'), desc: 'Produit du bois. Près d’une forêt.' },
  quarry: { icon: gi('quarry'), desc: 'Produit de la pierre. Près d’une roche.' },
  mine: { icon: gi('mine'), desc: 'Produit du minerai. Près d’un filon.' },
  smelter: { icon: gi('smelter'), desc: 'Fond 2 minerais en 1 fer.' },
  armory: { icon: gi('armory'), desc: 'Forge épées et arcs.' },
  barracks: { icon: gi('barracks'), desc: 'Transforme habitant + arme en guerrier.' },
  tower: { icon: gi('tower'), desc: 'Tire sur les ennemis à portée.' },
};

export const WEAPON_UI: Record<WeaponType, { icon: string }> = {
  sword: { icon: gi('sword') },
  bow: { icon: gi('bow') },
};

export const UNIT_UI: Record<UnitType, { icon: string; role: string }> = {
  knight: { icon: gi('knight'), role: 'Mêlée, solide, fort contre les archers' },
  archer: { icon: gi('archer'), role: 'Distance, fragile, touche avant le contact' },
};

/** Short number: 1234 → "1 234", 15300 → "15,3k". */
export function fmt(n: number): string {
  const v = Math.floor(n);
  return v >= 10000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : v.toLocaleString('fr-FR');
}

/** Cost chips; a chip is red when the village can't pay that part. */
export function costHtml(cost: Cost, village: Village): string {
  return RESOURCE_UI.filter((r) => (cost[r.key] ?? 0) > 0)
    .map((r) => {
      const need = cost[r.key] ?? 0;
      return `<span class="cost${village.resources[r.key] < need ? ' short' : ''}">${r.icon}${need}</span>`;
    })
    .join('');
}

/**
 * Kenney UI skin (CC0) as CSS variables. Declared inline on the HUD root so the
 * relative URLs resolve against the page (works with Vite's `base: './'` and Capacitor).
 */
const KENNEY: Record<string, string> = {
  panel: 'panel_beigeLight',
  'panel-wood': 'panel_brown',
  inset: 'panelInset_beige',
  'inset-light': 'panelInset_beigeLight',
  btn: 'buttonLong_beige',
  'btn-pressed': 'buttonLong_beige_pressed',
  'btn-wood': 'buttonLong_brown',
  'btn-wood-pressed': 'buttonLong_brown_pressed',
  'btn-blue': 'buttonLong_blue',
  'btn-blue-pressed': 'buttonLong_blue_pressed',
  'btn-grey': 'buttonLong_grey',
  tab: 'buttonSquare_beige',
  'tab-active': 'buttonSquare_brown',
  close: 'iconCross_beige',
  ornament: 'ornament',
  'bar-back-l': 'barBack_horizontalLeft',
  'bar-back-m': 'barBack_horizontalMid',
  'bar-back-r': 'barBack_horizontalRight',
  'bar-green-l': 'barGreen_horizontalLeft',
  'bar-green-m': 'barGreen_horizontalMid',
  'bar-green-r': 'barGreen_horizontalRight',
  'bar-red-l': 'barRed_horizontalLeft',
  'bar-red-m': 'barRed_horizontalMid',
  'bar-red-r': 'barRed_horizontalRight',
  'bar-yellow-l': 'barYellow_horizontalLeft',
  'bar-yellow-m': 'barYellow_horizontalMid',
  'bar-yellow-r': 'barYellow_horizontalRight',
};

export const kenneySkin = (): string =>
  Object.entries(KENNEY)
    .map(([key, file]) => `--k-${key}:url(ui/kenney/${file}.png)`)
    .join(';');

export const hexColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
