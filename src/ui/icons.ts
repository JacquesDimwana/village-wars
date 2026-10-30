import type { BuildingType, Cost, ResourceType, UnitType, Village, WeaponType } from '../core/types';

export const RESOURCE_UI: { key: ResourceType; icon: string; label: string }[] = [
  { key: 'wood', icon: '🪵', label: 'Bois' },
  { key: 'stone', icon: '🪨', label: 'Pierre' },
  { key: 'ore', icon: '⛏️', label: 'Minerai' },
  { key: 'iron', icon: '⚙️', label: 'Fer' },
];

export const BUILDING_UI: Record<BuildingType, { icon: string; desc: string }> = {
  townHall: { icon: '🏰', desc: 'Cœur du village. Détruit = défaite.' },
  house: { icon: '🏠', desc: '+5 places pour de nouveaux habitants.' },
  lumberCamp: { icon: '🪓', desc: 'Produit du bois. Près d’une forêt.' },
  quarry: { icon: '🪨', desc: 'Produit de la pierre. Près d’une roche.' },
  mine: { icon: '⛏️', desc: 'Produit du minerai. Près d’un filon.' },
  smelter: { icon: '🔥', desc: 'Fond 2 minerais en 1 fer.' },
  armory: { icon: '⚒️', desc: 'Forge épées et arcs.' },
  barracks: { icon: '🛡️', desc: 'Transforme habitant + arme en guerrier.' },
  tower: { icon: '🗼', desc: 'Tire sur les ennemis à portée.' },
};

export const WEAPON_UI: Record<WeaponType, { icon: string }> = {
  sword: { icon: '🗡️' },
  bow: { icon: '🏹' },
};

export const UNIT_UI: Record<UnitType, { icon: string; role: string }> = {
  knight: { icon: '⚔️', role: 'Mêlée, solide, fort contre les archers' },
  archer: { icon: '🎯', role: 'Distance, fragile, touche avant le contact' },
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

export const hexColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
