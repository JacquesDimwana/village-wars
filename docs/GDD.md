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

- Grille de tuiles (1 tuile = 1 unité 3D). **Carte finie** de `game.json` → `map.halfSize`
  × 2 tuiles de côté (240 × 240), centrée sur le village du joueur et générée à partir d'une
  **seed** (même seed = même carte). Elle est découpée en chunks de 32×32 tuiles chargés
  autour de la caméra. Les `map.borderWidth` dernières tuiles descendent vers une mer qui
  entoure toute la carte (infranchissable) : on voit clairement le bord du monde. La caméra
  ne peut pas sortir de la carte, et la mini-carte montre la carte entière.
- Terrain (bruit simplex) : `water` (infranchissable), `sand`, `grass`, `forest`
  (bois), `rock` (pierre), `ore` (minerai de fer, rare, dans les zones rocheuses).
- Le joueur spawn en (0,0). Les 5 villages IA spawn sur un cercle de rayon
  `aiSpawnRadius` tuiles (voir `game.json`), angles espacés + jitter, sur tuile
  constructible. Une zone de 5×5 autour de chaque hôtel de ville est forcée en `grass`.
- **Brouillard de guerre** : seules les tuiles dans le rayon de vision des unités et
  bâtiments du joueur sont visibles ; les tuiles déjà vues restent grisées.
- **Exploration** : au départ, la carte est inconnue (grisée sur la mini-carte). Chaque
  bâtiment du joueur découvre les tuiles dans son rayon `vision`. Les bâtiments de
  production (hôtel de ville, camp de bûcherons, carrière, mine) envoient leurs
  travailleurs chercher des ressources de plus en plus loin : leur rayon d'exploration
  grandit de `exploration.growthPerSecond` × postes occupés / postes totaux, jusqu'à
  `exploration.maxRadius` (`game.json`). Les guerriers découvrent les tuiles dans leur
  rayon `vision`. Une tuile découverte le reste.

## 3. Ressources

| Ressource | Source | Notes |
|---|---|---|
| Bois (`wood`) | Camp de bûcherons (+ un peu par l'hôtel de ville) | Ressource de base, arcs |
| Pierre (`stone`) | Carrière (+ un peu par l'hôtel de ville) | Bâtiments |
| Minerai (`ore`) | Mine | Ne sert qu'à faire du fer |
| Fer (`iron`) | Fonderie : 2 minerai → 1 fer | Épées, armurerie |

Ressources de départ : `game.json` → `startingResources`.

**Rythme visé (partie de 15 à 25 min)**, vérifié par une simulation dans
`tests/pacing.test.ts` (joueur raisonnable, un chantier à la fois) :

| Jalon | Visé | Simulé |
|---|---|---|
| 1re maison | ≈ 1 min | 0,8 min |
| Camp de bûcherons et carrière | avant 3 min | 0,2 et 0,4 min |
| Armurerie (50 fer) | 6 à 9 min | 8,4 min |
| ≈ 8 guerriers | 10 à 13 min | 12,4 min |
| 40 habitants | ≈ 8 min | 6,8 min |
| 100 habitants | 14 à 16 min | 12,2 min |

Récolte manuelle (`units.json` → `villager`) : charge **10**, **0,5 unité/s** sur la
tuile, vitesse 1,8 tuile/s. Un villageois rapporte ainsi **0,45/s à 2 tuiles du dépôt et
0,37/s à 6 tuiles** (0,4/s par poste au camp de bûcherons) : la récolte à la main ne bat
pas un bâtiment. Une tuile de forêt (150 bois) se vide en **≈ 6 min** pour un villageois :
les forêts proches s'épuisent en milieu de partie, ce qui pousse à s'étendre.

## 4. Habitants, emploi et guerriers (cœur du jeu)

C'est le dilemme central : **chaque habitant est soit un travailleur, soit un guerrier.**

- **Habitation** : chaque bâtiment avec `population` (maisons +10, hôtel de ville +5 par
  niveau) offre des places. Plus le village est grand, plus il peut loger d'habitants.
- **Croissance** : tant qu'il reste des places libres, les habitants arrivent tout seuls,
  d'autant plus vite que le village a de maisons : `baseGrowthPerSecond` (0,05/s) +
  `growthPerHouse` (0,022/s) par maison terminée, plafonné à `maxGrowthPerSecond`
  (0,2/s) (`resources.json` → `population`). Les guerriers occupent aussi une place.
- **Ouvriers de départ** : chaque village démarre à l'hôtel de ville avec
  `game.json` → `startingWorkers` ouvriers (3, inclus dans `startingInhabitants`). Ils
  **ne peuvent jamais devenir guerriers** : ils travaillent, récoltent à la main et
  explorent (envoyés loin, ils découvrent la carte autour d'eux). Ils comptent dans la
  population et l'habitation. Morts, ils ne sont pas remplacés ; les habitants nés de la
  croissance sont tous mobilisables. Ils se distinguent visuellement (tenue claire, outil)
  et leur fiche indique « Ouvrier — ne peut pas être enrôlé ». La caserne ne compte comme
  « habitants dispo » que les habitants mobilisables (`enlistableCount`).
- **Emploi** : tous les habitants civils travaillent automatiquement. Les bâtiments de
  production ont des postes (`workerSlots`). Ils sont remplis dans l'ordre de
  construction, l'hôtel de ville (production faible de secours) en dernier.
  **Production = production max × postes occupés / postes totaux.** Fonderie et
  armurerie fonctionnent aussi au prorata de leurs travailleurs.
- **Villageois visibles (modèle hybride)** : chaque habitant civil est un villageois
  visible sur la carte. Par défaut il va seul au travail : la règle de production
  ci-dessus reste la seule source de production automatique, les villageois ne font
  que la *montrer* par des allers-retours visibles entre leur bâtiment et la ressource
  proche (forêt, roche, filon), avec la ressource portée au-dessus de la tête. Les
  travailleurs de la fonderie et de l'armurerie restent devant leur bâtiment. Les
  habitants sans poste se promènent dans le village. Pour ne pas encombrer l'écran,
  seuls `game.json` → `villagers.maxVisible` (14) villageois par village sont dessinés et
  se déplacent ; les autres travaillent « à l'intérieur » de leur bâtiment (comptés, pas
  dessinés). Les villageois qui ont reçu un ordre manuel sont toujours visibles. La
  production reste celle des postes, indépendante de l'affichage.
- **Ordres manuels (facultatifs)** : le joueur peut sélectionner un villageois et
  - toucher une forêt / un rocher / un filon : il quitte son poste et **récolte cette
    tuile lui-même** (`units.json` → `villager` : vitesse, charge, vitesse de récolte).
    Il rapporte sa charge au bâtiment de dépôt le plus proche (camp de bûcherons pour le
    bois, carrière pour la pierre, mine pour le minerai, l'hôtel de ville pour tout), qui
    crédite le village. Chaque tuile contient `resources.json` → `tileAmounts` ; une
    tuile vide est épuisée et le villageois passe à la tuile du même type la plus proche
    (sinon il reprend un poste). C'est utile pour récolter une ressource sans bâtiment
    (ex. du minerai avant la mine). Un récolteur manuel n'occupe pas de poste.
  - toucher un bâtiment de production à lui : il y est **affecté en priorité** (les
    postes sont d'abord donnés aux villageois affectés à la main, puis aux autres dans
    l'ordre de construction). Sans ordre manuel, rien ne change : aucune micro-gestion
    n'est obligatoire.
  - toucher le sol : il y va, puis reprend son poste automatique.
- **Armurerie** : forge les armes à partir des ressources — **épée** (bois + fer) et
  **arc** (bois). File d'attente, vitesse proportionnelle au nombre de forgerons.
- **Conversion** : à la caserne, **1 habitant mobilisable + 1 arme → 1 guerrier** (épée →
  chevalier, arc → archer). Le guerrier quitte son poste : **la production du village
  baisse**. Il sort de la caserne et rejoint un camp d'armée (§6).
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
| Maison | +10 places d'habitation | — |
| Camp de bûcherons | Bois, doit être à ≤ 4 tuiles d'une forêt | 3 |
| Carrière | Pierre, doit être à ≤ 4 tuiles d'une roche | 3 |
| Mine | Minerai, doit être à ≤ 4 tuiles d'un minerai | 3 |
| Fonderie | 2 minerai → 1 fer toutes les 5 s | 2 |
| Armurerie | Forge épées et arcs | 2 |
| Caserne | Convertit habitant + arme en chevalier ou archer | — |
| Tour de défense | Tire automatiquement sur les ennemis à portée | — |
| Camp d'armée | Abrite les soldats au repos (4×4, terrain ouvert traversable) | — |

Construction : sur grille, tuiles libres et constructibles (`grass`/`sand`), à ≤
`buildRadius` tuiles d'un bâtiment existant du joueur. On ne peut pas construire sur les
arbres (`forest`), la roche (`rock`), le minerai (`ore`) ni l'eau. Une tuile de forêt,
de roche ou de minerai dont la ressource est épuisée (`depletion` à 0) est dégagée :
elle devient de l'herbe constructible et son décor (arbre, rocher) disparaît. L'eau
reste toujours infranchissable et inconstructible. Un bâtiment en construction a
une barre de progression et ne produit rien. Les unités ne gênent jamais la construction :
un villageois ou un soldat qui se trouve sous un bâtiment posé se décale vers la tuile libre
la plus proche.

## 6. Unités

Version de départ : **2 unités, toutes deux des guerriers** issus des habitants, plus
les **villageois** (habitants civils, voir §4), visibles et sans combat.

| Unité | Arme | Rôle | Avantage |
|---|---|---|---|
| Chevalier | Épée | Mêlée, beaucoup de PV, rapide, ×1.5 dégâts aux bâtiments | ×1.5 dégâts contre les archers au contact |
| Archer | Arc (modèle 3D : arbalète) | Distance (portée 5), fragile, arme bon marché | Frappe les chevaliers avant qu'ils arrivent |

Stats dans `src/config/units.json`. Multiplicateur de contre : ×1.5.
Combat : automatique. Un guerrier attaque l'ennemi le plus proche dans son `aggroRange`.
Les guerriers au repos dans un village attaqué défendent automatiquement.
Déplacement (guerriers et villageois) : A* 8 directions sur la grille, sans couper les
coins, recherche bornée ; l'eau et les bâtiments bloquent (forêts, roches et filons se
traversent, le camp d'armée aussi). Un groupe envoyé sur une tuile se répartit sur les
tuiles libres autour. **Pas de bouchon dans le village** : les unités alliées se
traversent ; seules les unités ennemies se repoussent (combat).

**Camps d'armée (au repos).** Chaque soldat au repos appartient au camp d'armée terminé le
moins rempli de son village ; sans camp, il attend devant la caserne en bloc compact
(≈ √n colonnes). Un camp n'a pas de limite de capacité, mais n'affiche au plus que
`armyCamp.visibleSoldiers` (8) figurines, réparties entre chevaliers et archers au
prorata, avec un badge « ⚔️ 24 » qui donne le total. Toucher le camp ouvre sa fiche
(chevaliers ×N, archers ×N, total) avec « Former des troupes » et « Partir en guerre ».

**Partir en guerre.** « Partir en guerre » sélectionne toute l'armée du camp ; le
joueur touche une destination. Les soldats sortent du camp un par un
(`game.json` → `army.departIntervalMs`), en colonne, deviennent visibles et avancent. Ils
restent à destination (et découvrent la carte) jusqu'au bouton « Rentrer », qui les
ramène au camp où ils redeviennent comptés sans être dessinés.

## 7. Contrôles (tactile)

- Glisser 1 doigt sur le vide : déplacer la caméra
- Pincer : zoom (distance caméra 10 à 90 ; au-delà de ≈ 45, vue stratégique allégée : décor simplifié au loin)
- Tap sur un guerrier ou un villageois : sélection (anneau jaune au sol) ; tap long +
  glisser : sélection en rectangle (guerriers et villageois du joueur). Une barre en bas
  au centre résume la sélection (« 🛡️ 4 · 👷 2 ») avec ✕ pour désélectionner.
- Avec une sélection : tap sur le sol = déplacer (marqueur de destination) ; tap sur
  forêt / roche / filon = les villageois sélectionnés y récoltent, les guerriers s'en
  approchent ; tap sur un bâtiment de production = les villageois y sont affectés
  (attaquer selon la cible : voir combat). Avec des soldats sélectionnés, la barre
  propose « Rentrer » (retour au camp).
- Tap sur un camp d'armée : fiche du camp (« Former des troupes », « Partir en guerre »).
- Bouton « Construire » : menu bâtiments → fantôme vert/rouge → tap pour poser

**Sur ordinateur (souris + clavier)**, mêmes règles, gestes de RTS classiques :

- Clic gauche : sélectionner (unité, villageois, bâtiment) ; clic gauche + glisser sur le
  sol : rectangle de sélection (pas besoin d'appui long) ; Maj + clic / Maj + rectangle :
  ajouter à la sélection.
- Clic droit : donner l'ordre à la sélection (déplacer, récolter, affecter, partir en
  guerre) ; sans sélection, il ne fait rien.
- Trackpad (Mac) : glisser à deux doigts = déplacer la carte ; pincer = zoom.
- Déplacer la caméra : glisser avec le clic du milieu (ou clic droit maintenu), flèches /
  ZQSD / WASD, ou souris au bord de l'écran (plein écran seulement). Molette : zoom
  centré sur le curseur.
- Raccourcis : Échap = désélectionner / fermer le panneau ; B = Construire ; A = Armée ;
  Espace = revenir au village ; Ctrl + A = sélectionner tous les soldats visibles.
- Curseur : main sur ce qui se sélectionne, curseur d'ordre (récolter / déplacer) au survol
  quand une sélection est active.
- Interface : sur grand écran (≥ 1280 px), le HUD garde des tailles fixes lisibles (pas
  d'éléments géants), panneaux limités en largeur et centrés ; tout reste utilisable de
  1280×720 à 2560×1440 et en fenêtre redimensionnée.
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

Style inspiré de Clash of Clans : panneaux crème bordés de bois, gros boutons ronds,
textes courts. Le jeu reste jouable pendant qu'un panneau est ouvert.

- Haut gauche : blason du village + barre de population en 3 segments
  (travailleurs / guerriers / places libres) — rend visible le dilemme du §4.
- Haut centre : bois / pierre / minerai / fer avec production par seconde.
- Bas gauche : gros bouton rond **Armée** (badge = armes en stock) et bouton
  **Diplomatie**. Bas droite : gros bouton **Construire**.
- Chaque bouton ouvre un panneau qui glisse depuis le bas (fermeture : ✕) :
  - **Construire** : cartes des bâtiments (icône, rôle, coût en rouge si insuffisant).
  - **Armée** : forge (épée / arc, file d'attente avec progression) et caserne
    (former / démobiliser chevaliers et archers). Une action impossible est grisée avec
    sa raison (« Construis une armurerie », « Pas d'épée en stock »…).
  - **Diplomatie** : les 5 villages IA ; nom et personnalité visibles une fois leur
    hôtel de ville exploré, bouton « Voir » qui centre la caméra dessus.
- Tap sur un bâtiment : fiche en bas au centre (propriétaire, PV, construction,
  travailleurs, production). Tap sur le sol : la fiche se ferme.
- Mini-carte en haut à droite : zone de `minimap.halfSize` tuiles autour de l'hôtel de
  ville du joueur (couvre les 5 villages IA). Tuiles inconnues en gris, tuiles explorées
  avec la couleur du terrain, bâtiments explorés aux couleurs des villages, guerriers du
  joueur, cercle blanc = zone vue par la caméra. Tap sur la mini-carte : la caméra y va.
- Notifications : « Village X vous attaque ! », « Alliance acceptée »

## 12. Hors périmètre

Multijoueur en ligne, arbre technologique, campagne, plusieurs maps, monétisation.

## 13. Bonus si temps restant

Sons (Kenney audio), animations de combat, tutoriel en 4 étapes, vitesse ×2.
