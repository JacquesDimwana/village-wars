# Plan 48 h — Village Wars

## État actuel (fourni au départ)

- [x] Setup Vite + TypeScript + Capacitor
- [x] **Rendu 3D Three.js** style Clash of Clans : terrain par chunks instanciés, bâtiments KayKit aux couleurs des équipes, guerriers animés (chevalier, archer), ombres, brouillard de distance
- [x] Version 2D Phaser sauvegardée sur la branche `phaser-2d` (plan B)
- [x] GDD, CLAUDE.md, configs JSON d'équilibrage
- [x] Map pseudo-infinie par chunks (seed, bruit simplex, eau/sable/herbe/forêt/roche/minerai)
- [x] Caméra tactile (glisser, pincer, molette sur desktop), tap → identification du bâtiment / de la tuile
- [x] HUD HTML (ressources + production/s, travailleurs, guerriers, places, armes)
- [x] Spawn du joueur + 5 villages IA
- [x] Économie : production au prorata des travailleurs, fonderie, coûts + tests
- [x] Habitation, croissance des habitants, emploi automatique + tests
- [x] Armurerie (file de forge épées/arcs) + conversion habitant → guerrier / démobilisation + tests

## Découpage en agents parallèles

Chaque agent travaille dans sa branche / son worktree. Les systèmes communiquent
uniquement via `GameState` et `EventBus`, donc ils sont indépendants.

| Agent | Branche | Fichiers principaux | Dépend de |
|---|---|---|---|
| A — Construction | `feat/construction` | `systems/ConstructionSystem.ts`, menu Construire (`ui/`), fantôme de placement (`render/`) | base |
| B — Armée & déplacements | `feat/army` | menu Armée (forge, conversion, démobilisation), `systems/MovementSystem.ts` (easystar), sélection des guerriers | base |
| C — Combat | `feat/combat` | `systems/CombatSystem.ts`, tours de défense, déclenche `EntityRenderer.attack()` | B |
| D — IA ennemie | `feat/ai` | `systems/AISystem.ts` | A + B fusionnés |
| E — Diplomatie & fog | `feat/diplomacy` | `systems/DiplomacySystem.ts`, `systems/FogSystem.ts`, UI diplomatie | base |
| F — UI & fin de partie | `feat/ui` | `ui/`, écran victoire/défaite, sauvegarde | base |

## Planning

| Créneau | Vague | Agents en parallèle |
|---|---|---|
| H0–H1 | Lecture du repo, `npm install`, test sur téléphone | — |
| **H12** | **Décision 3D** : si fluide sur téléphone → on continue ; sinon logique rebranchée sur `phaser-2d` | — |
| H1–H8 | Vague 1 | A, B, E, F |
| H8–H9 | Merge + playtest | — |
| H9–H16 | Vague 2 | C, D, suite de F |
| H16–H18 | Merge + playtest complet | — |
| H18–H26 | **Sommeil** | — |
| H26–H34 | Vague 3 : intégration diplomatie ↔ IA, équilibrage, bugs | 2–3 agents sur bugs listés |
| **H34** | **Point d'étape** : si retard → couper fog puis diplomatie avancée (renforts) | — |
| H34–H42 | Bonus : sons, animations, tutoriel, mini-carte | selon temps |
| H42–H46 | Tests sur vrai téléphone, équilibrage final | — |
| H46–H48 | APK, déploiement Vercel, README + section Workflow IA, vidéo 1 min | — |

## Prompt type pour lancer un agent

```
Lis CLAUDE.md et docs/GDD.md (sections X et Y).
Implémente <fonctionnalité> dans <fichiers>.
Contraintes : logique dans systems/ sans Three.js, valeurs dans src/config/*.json,
ajoute des tests dans tests/. Termine quand npm run typecheck et npm test passent.
Ne touche pas à <fichiers des autres agents>.
```

## Journal (à remplir au fil de l'eau — sert pour le README « Workflow IA »)

| Heure | Agent | Tâche | Durée | Remarques |
|---|---|---|---|---|
| | | | | |
