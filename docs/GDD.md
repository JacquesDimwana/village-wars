# Village Wars — Game Design Document

> Spec de référence. Toute fonctionnalité codée doit correspondre à ce document.
> Si une règle change, on modifie **d'abord** ce fichier, **puis** le code.

## 1. Pitch

RTS mobile en 3D low-poly, caméra fixe inclinée (style Clash of Clans). Le joueur démarre avec un hôtel de ville sur une map
pseudo-infinie générée procéduralement. 5 villages IA démarrent loin de lui. Il faut
loger des habitants, les faire travailler ou les armer, nouer des alliances, et détruire tous les
hôtels de ville ennemis avant que le sien tombe.

- Plateforme : Android (APK via Capacitor) + web (Vercel)
- Orientation : paysage
- Durée d'une partie : 15 à 25 minutes
- Mode : solo contre 5 IA (pas de multijoueur en ligne)

## 2. Monde

- Grille de tuiles (1 tuile = 1 unité 3D). Map découpée en **chunks de 32×32 tuiles**, générés à la
  volée autour de la caméra à partir d'une **seed** (même seed = même map).
- Terrain (bruit simplex) : `water` (infranchissable), `sand`, `grass`, `forest`
  (bois), `rock` (pierre), `ore` (minerai de fer, rare, dans les zones rocheuses).
- Le joueur spawn en (0,0). Les 5 villages IA spawn sur un cercle de rayon
  `aiSpawnRadius` tuiles (voir `game.json`), angles espacés + jitter, sur tuile
  constructible. Une zone de 5×5 autour de chaque hôtel de ville est forcée en `grass`.
- **Brouillard de guerre** : seules les tuiles dans le rayon de vision des unités et
  bâtiments du joueur sont visibles ; les tuiles déjà vues restent grisées.

## 3. Ressources

| Ressource | Source | Notes |
|---|---|---|
| Bois (`wood`) | Camp de bûcherons (+ un peu par l'hôtel de ville) | Ressource de base, arcs |
| Pierre (`stone`) | Carrière (+ un peu par l'hôtel de ville) | Bâtiments |
| Minerai (`ore`) | Mine | Ne sert qu'à faire du fer |
| Fer (`iron`) | Fonderie : 2 minerai → 1 fer | Épées, armurerie |

Ressources de départ : `game.json` → `startingResources`.

## 4. Habitants, emploi et guerriers (cœur du jeu)

C'est le dilemme central : **chaque habitant est soit un travailleur, soit un guerrier.**

- **Habitation** : chaque bâtiment avec `population` (maisons +5, hôtel de ville +5 par
  niveau) offre des places. Plus le village est grand, plus il peut loger d'habitants.
- **Croissance** : tant qu'il reste des places libres, les habitants arrivent tout seuls
  (`resources.json` → `population.growthPerSecond`). Les guerriers occupent aussi une place.
- **Emploi** : tous les habitants civils travaillent automatiquement. Les bâtiments de
  production ont des postes (`workerSlots`). Ils sont remplis dans l'ordre de
  construction, l'hôtel de ville (production faible de secours) en dernier.
  **Production = production max × postes occupés / postes totaux.** Fonderie et
  armurerie fonctionnent aussi au prorata de leurs travailleurs.
- **Armurerie** : forge les armes à partir des ressources — **épée** (bois + fer) et
  **arc** (bois). File d'attente, vitesse proportionnelle au nombre de forgerons.
- **Conversion** : à la caserne, **1 habitant + 1 arme → 1 guerrier** (épée → chevalier,
  arc → archer). Le guerrier quitte son poste : **la production du village baisse**.
- **Démobilisation** : un guerrier peut redevenir habitant (il rend son arme au stock et
  reprend un poste).

Conséquence stratégique : une grosse armée = une économie ralentie. Il faut choisir le
bon moment pour mobiliser, et agrandir le village (maisons) pour avoir les deux.

## 5. Bâtiments

Valeurs (coût, PV, taille, postes, production, temps de construction) dans
`src/config/buildings.json`.

| Bâtiment | Rôle | Postes |
|---|---|---|
| Hôtel de ville | Cœur du village, 3 niveaux, loge 5 habitants/niveau. Détruit = défaite | 3 |
| Maison | +5 places d'habitation | — |
| Camp de bûcherons | Bois, doit être à ≤ 4 tuiles d'une forêt | 3 |
| Carrière | Pierre, doit être à ≤ 4 tuiles d'une roche | 3 |
| Mine | Minerai, doit être à ≤ 4 tuiles d'un minerai | 3 |
| Fonderie | 2 minerai → 1 fer toutes les 5 s | 2 |
| Armurerie | Forge épées et arcs | 2 |
| Caserne | Convertit habitant + arme en chevalier ou archer | — |
| Tour de défense | Tire automatiquement sur les ennemis à portée | — |

Construction : sur grille, tuiles libres et constructibles (`grass`/`sand`), à ≤
`buildRadius` tuiles d'un bâtiment existant du joueur. Un bâtiment en construction a
une barre de progression et ne produit rien.

## 6. Unités

Version de départ : **2 unités, toutes deux des guerriers** issus des habitants.
Les habitants civils ne sont pas affichés sur la map (ce sont des chiffres dans le HUD).

| Unité | Arme | Rôle | Avantage |
|---|---|---|---|
| Chevalier | Épée | Mêlée, beaucoup de PV, rapide, ×1.5 dégâts aux bâtiments | ×1.5 dégâts contre les archers au contact |
| Archer | Arc (modèle 3D : arbalète) | Distance (portée 5), fragile, arme bon marché | Frappe les chevaliers avant qu'ils arrivent |

Stats dans `src/config/units.json`. Multiplicateur de contre : ×1.5.
Combat : automatique. Un guerrier attaque l'ennemi le plus proche dans son `aggroRange`.
Les guerriers au repos dans un village attaqué défendent automatiquement.
Déplacement : A* sur la grille (easystar), l'eau et les bâtiments bloquent.

## 7. Contrôles (tactile)

- Glisser 1 doigt sur le vide : déplacer la caméra
- Pincer : zoom (distance caméra 10 à 36)
- Tap sur unité : sélection ; tap long + glisser : sélection en rectangle
- Tap sur sol avec guerriers sélectionnés : déplacer / attaquer selon la cible
- Bouton « Construire » : menu bâtiments → fantôme vert/rouge → tap pour poser
- Bouton « Armée » : forger des armes (armurerie), convertir / démobiliser (caserne)
- Bouton « Diplomatie » : liste des 5 villages IA

## 8. IA ennemie

Machine à états évaluée toutes les 2 s par village :

1. **ECONOMY** : construire des maisons quand la population ≥ 80 % des places, puis
   producteurs, fonderie, armurerie, caserne.
2. **MILITARY** : forger des armes et convertir des habitants selon la personnalité,
   en gardant au moins `minWorkers` travailleurs (`ai.json`).
3. **ATTACK** : quand la puissance de l'armée ≥ `attackThreshold` × puissance estimée
   de la cible, envoyer l'armée sur l'hôtel de ville cible (le plus faible ou le plus
   proche, selon personnalité).
4. **DEFEND** : si un ennemi est dans le village, toutes les unités militaires défendent.

Personnalités (`src/config/ai.json`) :

| Personnalité | Comportement |
|---|---|
| Agressive | Caserne tôt, attaque dès un seuil bas, refuse presque toutes les alliances |
| Économe | Maximise la production, attaque tard avec une grosse armée |
| Diplomate | Accepte facilement les alliances, envoie des ressources, n'attaque jamais un allié |

Puissance d'armée = somme de (PV × attaque) des unités militaires.

## 9. Diplomatie / alliances

Actions possibles vers chaque village IA connu (découvert dans le brouillard) :

- **Proposer une alliance** : accepté si `score = baseAcceptance[personnalité] +
  (ta puissance / sa puissance) × 0.3 - relationsNégatives` > 0.5
- **Envoyer des ressources** : +relation, un convoi traverse la map
- **Demander des ressources** : un allié accepte si son stock dépasse 2× ses besoins
- **Demander des renforts** : un allié envoie 30 % de son armée vers ta cible
- **Rompre l'alliance**

Les alliés ne s'attaquent pas. Une alliance n'empêche pas la victoire : à la fin, il
faut que tous les hôtels de ville **non alliés** soient détruits ; si seuls des alliés
restent, une dernière alerte rompt les alliances (« Il ne peut en rester qu'un »).

## 10. Conditions de fin

- **Victoire** : tous les hôtels de ville ennemis détruits.
- **Défaite** : ton hôtel de ville détruit.
- Écran de fin : temps de partie, unités formées, ressources récoltées, villages détruits.

## 11. Interface

- Barre du haut : bois / pierre / minerai / fer, puis travailleurs / guerriers / places / épées / arcs
- Bas à gauche : boutons Construire, Armée, Diplomatie
- Bas à droite : panneau contextuel (sélection)
- Mini-carte en haut à droite (si le temps le permet)
- Notifications : « Village X vous attaque ! », « Alliance acceptée »

## 12. Hors périmètre

Multijoueur en ligne, arbre technologique, campagne, plusieurs maps, monétisation.

## 13. Bonus si temps restant

Sons (Kenney audio), animations de combat, tutoriel en 4 étapes, mini-carte, vitesse ×2.
