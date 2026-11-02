# Village Wars

RTS mobile 3D low-poly (style Clash of Clans) : agrandis ton village, fais travailler ou arme tes habitants, allie-toi ou
écrase les 5 villages voisins.

- **Spec** : [`docs/GDD.md`](docs/GDD.md)
- **Planning & agents** : [`docs/PLAN.md`](docs/PLAN.md)
- **Contexte IA** : [`CLAUDE.md`](CLAUDE.md)

## Stack

Three.js · TypeScript · Vite · Capacitor (Android) · simplex-noise · easystar.js · Vitest

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173 (et sur le téléphone via l'IP locale affichée)
npm test             # tests de la logique de jeu
npm run build        # build web → dist/
```

### APK Android

```bash
npx cap add android  # une seule fois
npm run android      # build + sync + ouvre Android Studio → Run / Build APK
```

## Architecture

La logique (`src/systems`, `src/core`, `src/world/WorldGen.ts`) est en TypeScript pur,
testée avec Vitest. Three.js ne fait que l'affichage (`src/render`), le HUD est en HTML (`src/ui`).
Tout l'équilibrage est dans `src/config/*.json`.

## Crédits

Modèles 3D : [KayKit](https://kaylousberg.com) par Kay Lousberg — Medieval Hexagon Pack et Forest Nature Pack (CC0)
et Adventurers Character Pack (CC0).

Interface : [Kenney](https://kenney.nl) — UI Pack (RPG Expansion) et Fantasy UI Borders (CC0).
Icônes : [game-icons.net](https://game-icons.net) par Lorc, Delapouite et Sbed (CC BY 3.0).
Détail dans `public/ui/CREDITS.md`.

## Workflow IA

_À compléter à la fin : outils, découpage en agents, journal de `docs/PLAN.md`,
temps passé par système._
