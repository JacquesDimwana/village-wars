# CLAUDE.md — Village Wars

Contexte permanent pour tout agent IA qui travaille sur ce repo. À lire avant toute tâche.

## Le projet

RTS mobile 2D (Phaser 4 + TypeScript + Vite, packagé Android avec Capacitor).
**La spec est `docs/GDD.md`. Elle fait autorité.** Le planning et le découpage par agent
sont dans `docs/PLAN.md`. Délai total : 48 h — privilégie toujours ce qui marche vite et
simple à ce qui est élégant.

## Commandes

```bash
npm run dev        # serveur Vite (accessible sur le réseau local pour tester sur téléphone)
npm run typecheck  # tsc --noEmit — doit passer avant chaque commit
npm test           # vitest — doit passer avant chaque commit
npm run build      # build de prod dans dist/
npm run android    # build + cap sync + ouvre Android Studio
```

## Architecture

```
src/
  config/      Données de jeu en JSON (bâtiments, unités, ressources, IA, réglages).
               AUCUNE valeur d'équilibrage en dur dans le code : tout passe par ici.
  core/        Types, état de jeu (GameState), EventBus, RNG à seed.
  world/       Génération procédurale (WorldGen) et chargement des chunks (ChunkManager).
  systems/     Logique pure, sans Phaser : Economy, Construction, Combat, AI, Diplomacy,
               Fog. Chaque système expose update(state, dtMs).
  entities/    Rendu Phaser des bâtiments et unités (lit l'état, ne contient pas de règles).
  scenes/      BootScene (chargement), GameScene (monde), UIScene (HUD superposé).
  input/       Caméra tactile, sélection, placement.
tests/         Tests vitest des systèmes (logique pure).
```

### Règles d'architecture

1. **Logique ≠ rendu.** Les règles du jeu vivent dans `systems/` et `core/`, en
   TypeScript pur, sans import de Phaser → testables avec vitest. Les scènes et
   entités lisent `GameState` et affichent.
2. **Un seul état source** : `GameState`. Pas d'état de jeu caché dans les sprites.
3. **Communication par événements** via `EventBus` (`core/EventBus.ts`) entre systèmes
   et UI (ex. `resources:changed`, `building:placed`, `village:destroyed`).
4. **Aléatoire déterministe** : utiliser `core/rng.ts` (seedé), jamais `Math.random()`
   dans la logique.
5. **Coordonnées** : la logique travaille en tuiles (`tx`, `ty`), le rendu en pixels.
   Conversion via `TILE_SIZE` dans `core/constants.ts`.
6. Le joueur est le village d'id `player`. Les IA ont les ids `ai-1` … `ai-5`.

## Conventions

- TypeScript strict, pas de `any`.
- Code et noms en anglais, textes affichés au joueur en français.
- Fichiers courts : un système par fichier.
- Chaque nouveau système ou règle de calcul a au moins un test dans `tests/`.
- Ne pas ajouter de dépendance sans raison claire.

## Git

- Une fonctionnalité = une branche = un commit propre, testé.
- Commits authored as JacquesDimwana, sans aucune mention d'IA (pas de `Co-Authored-By`).
- Messages en anglais, format `feat: …`, `fix: …`, `chore: …`.

## Définition de « terminé »

`npm run typecheck` et `npm test` passent, la fonctionnalité est jouable dans le
navigateur en mode mobile (DevTools, paysage), et elle correspond au GDD.
