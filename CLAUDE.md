# CLAUDE.md — Village Wars

Contexte permanent pour tout agent IA qui travaille sur ce repo. À lire avant toute tâche.

## Le projet

RTS mobile en 3D low-poly, vue fixe style Clash of Clans (Three.js + TypeScript + Vite,
packagé Android avec Capacitor). Modèles KayKit (CC0) dans `public/models/`.
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
  world/       Génération procédurale du terrain (WorldGen) — logique pure.
  systems/     Logique pure, sans Three.js : Population, Economy, Armory, puis
               Construction, Movement, Combat, AI, Diplomacy. Chaque système expose
               update(state, dtMs).
  render/      Three.js uniquement : Assets (chargement glTF), Terrain (chunks
               instanciés), EntityRenderer (bâtiments + guerriers animés), teams.
  input/       RtsCamera : caméra fixe inclinée, pan 1 doigt, pinch, tap → raycast.
  ui/          HUD en HTML/CSS par-dessus le canvas (Hud.ts, hud.css).
  Game.ts      Boucle : tick logique fixe (100 ms) + rendu à chaque frame.
tests/         Tests vitest des systèmes (logique pure).
public/models/ Modèles KayKit (glTF/glb, CC0).
```

### Règles d'architecture

1. **Logique ≠ rendu.** Les règles vivent dans `systems/`, `core/`, `world/` en
   TypeScript pur, sans import de Three.js → testables avec vitest. `render/` et `ui/`
   lisent `GameState` et affichent, sans règles du jeu.
2. **Un seul état source** : `GameState`. Pas d'état de jeu caché dans les objets 3D.
3. **Communication par événements** via `EventBus` (`core/EventBus.ts`).
4. **Aléatoire déterministe** : `core/rng.ts` (seedé), jamais `Math.random()` dans la logique.
5. **Coordonnées** : 1 tuile = 1 unité Three.js. Tuile (tx, ty) → monde (x = tx, z = ty).
   Le sol est à y = 0.
6. Le joueur est le village d'id `player`. Les IA ont les ids `ai-1` … `ai-5`.
7. **Performance mobile** : tout ce qui est nombreux (sol, arbres, rochers) passe par
   `InstancedMesh`. Les arbres ne projettent pas d'ombre. Vérifier
   `__vw.renderer.info.render` (draw calls < 300, triangles < 800k au dézoom max).

### Debug

Dans la console du navigateur : `__vw` est l'instance de `Game`.
`__vw.debugDemo()` ajoute des bâtiments et des guerriers au village du joueur.

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
