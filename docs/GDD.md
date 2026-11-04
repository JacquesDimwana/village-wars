# Village Wars — Game Design Document

> Référence de conception des Marches d’Orneval. Les valeurs ci-dessous sont des **valeurs initiales à implémenter puis équilibrer**, pas des résultats de simulation. Modifier d’abord ce document, puis les configurations et le code. L’univers et les visuels suivent `docs/ART_DIRECTION_CODEX.md` ; les noms et chiffres sont propres au jeu.

## 1. Pitch et cadre

RTS solo de gestion médiévale en 3D low-poly : développer un village, envoyer ses villageois travailler, construire une économie, traverser trois âges, former une armée et vaincre cinq villages IA. Android (Capacitor) et web, paysage, caméra inclinée. Partie visée : **15 à 25 minutes**. Pas de multijoueur en ligne.

## 2. Monde et exploration

Carte finie générée par seed : `map.halfSize` = 120, soit **240 × 240 tuiles**, une tuile valant une unité 3D. Chunks de 32 × 32 chargés autour de la caméra. Les `map.borderWidth` dernières tuiles descendent vers une mer infranchissable ; caméra et mini-carte restent dans les limites. Terrain : eau, sable, herbe, forêt, roche et filon de fer. Baies et animaux de chasse occupent des emplacements terrestres identifiables ; ils ne repoussent pas. Pas de pêche dans la version initiale.

Le joueur commence en (0,0), les cinq IA sur un cercle de rayon `aiSpawnRadius`, avec angles espacés et jitter, sur terrain constructible. Une zone 5 × 5 autour de chaque hôtel de ville est dégagée. La génération garantit à chaque village des ressources initiales accessibles : au moins 6 tuiles de baies, 6 animaux, 20 tuiles de forêt, 6 de pierre et 6 de fer à distance praticable, sans partager ces minima avec un autre village. Les ressources de départ doivent permettre de construire et de passer au deuxième âge ; la seed reste déterministe.

Brouillard de guerre : seules les tuiles dans la vision actuelle des unités et bâtiments alliés au joueur sont visibles ; celles déjà explorées restent grisées, les autres inconnues. Les unités révèlent leur environnement en se déplaçant ; les bâtiments révèlent leur rayon `vision`. Aucun rayon d’exploration automatique lié à la production. La mini-carte couvre toute la carte.

## 3. Ressources et récolte

Quatre stocks partagés par village : **nourriture** (`food`), **bois** (`wood`), **pierre** (`stone`) et **fer** (`iron`). Le fer est récolté directement sur les filons : pas de stock de minerai distinct ni de fonderie. Cette simplification conserve le choix d’accès à une ressource militaire rare tout en évitant une chaîne de transformation et une microgestion supplémentaires sur mobile.

| Source | Ressource | Quantité initiale par source (`resources.json` → `tileAmounts`) | Récolte brute par villageois |
|---|---|---:|---:|
| Buisson de baies | Nourriture | 150 | 0,7/s |
| Animal chassé | Nourriture | 120 | 0,8/s |
| Ferme | Nourriture | Renouvelable | 0,6/s |
| Tuile de forêt | Bois | 150 | 0,7/s |
| Tuile de roche | Pierre | 250 | 0,6/s |
| Tuile de filon | Fer | 200 | 0,6/s |

Un villageois reçoit explicitement un ordre de récolte, se rend à la source, prélève jusqu’à **10 unités**, puis rejoint le dépôt compatible accessible le plus proche, y crédite sa charge et retourne à sa source. Vitesses ci-dessus hors trajet et dépôt ; dépôt instantané, déplacement **1,8 tuile/s**. Une charge ne mélange pas les ressources. La quantité est retirée de la source pendant la récolte, pas au dépôt. Une charge partielle est déposée si la source s’épuise. Si le villageois meurt, sa charge est perdue. Si le dépôt disparaît ou devient inaccessible, il cherche le dépôt compatible accessible suivant ; sans dépôt, il conserve sa charge et devient inactif jusqu’à nouvel ordre ou disponibilité d’un dépôt.

À épuisement, le villageois cherche la source accessible du même type la plus proche ; à défaut il dépose sa charge et devient inactif. Les arbres, rochers et filons épuisés disparaissent et leur tuile devient herbe constructible ; les baies disparaissent. Un animal est d’abord tué par le villageois sur ordre de chasse, puis sa carcasse est récoltée comme source finie ; elle disparaît une fois vide. Les animaux ne repoussent pas. Les fermes sont renouvelables sans réensemencement ni épuisement, une seule personne par ferme ; elles ne produisent que lorsqu’un villageois y travaille.

Dépôts terminés : hôtel de ville pour les quatre ressources ; camp de bûcherons pour le bois ; camp de mineurs pour pierre et fer ; moulin pour nourriture. Les dépôts n’ont ni postes ni production. Aucun stock n’est crédité automatiquement ou au prorata. Les villageois restent visibles et simulés. Un ordre de déplacement interrompt le travail ; arrivé à destination, le villageois est inactif. Un nouvel ordre remplace l’ancien ; une charge conservée est déposée avant de récolter une autre ressource.

## 4. Population et départ

Chaque village commence avec **un hôtel de ville terminé, 3 villageois ordinaires**, aucun soldat et les stocks suivants (`game.json` → `startingResources`) :

| Nourriture | Bois | Pierre | Fer |
|---:|---:|---:|---:|
| 200 | 250 | 100 | 50 |

Les trois villageois initiaux obéissent aux mêmes règles que les suivants : aucune catégorie d’ouvriers non mobilisables. Les soldats étant formés directement, cette distinction n’a plus de rôle et une seule catégorie de civil rend les ordres lisibles.

L’hôtel de ville donne **5 places**, chaque maison terminée **10** (demande du joueur), jusqu’à un plafond global de **100 unités** par village. Villageois et soldats occupent chacun une place, y compris au camp. La capacité est `min(100, 5 + 10 × maisons terminées)` ; perdre une maison peut laisser la population au-dessus de la capacité, sans tuer d’unités, mais bloque les nouvelles formations. Pas de croissance automatique ni de conversion ou démobilisation.

L’hôtel de ville forme des villageois pour **50 nourriture**, en **20 s** chacun. File FIFO commune avec le passage d’âge (§7), une action active à la fois. Chaque unité en file réserve une place et paie son coût à l’ajout ; une commande est refusée sans ressources ou place disponible. Annuler une entrée rembourse intégralement son coût et libère sa place, même si elle est en cours. Si une maison est détruite après réservation, la formation en cours et la file restent en pause tant que population vivante + places réservées dépasse la capacité ; elles reprennent quand la capacité suffit. Une sortie bloquée attend un emplacement libre sans perdre l’unité. Détruire un bâtiment de formation supprime sa file et rembourse ses coûts non terminés ; les unités déjà sorties restent.

## 5. Construction et bâtiments

Le joueur sélectionne des villageois, choisit un bâtiment et pose son plan sur des tuiles libres `grass`/`sand`, à portée `buildRadius` d’un bâtiment terminé allié à son village. Le coût est payé à la pose ; les villageois sélectionnés reçoivent l’ordre de construire et s’y rendent. On peut aussi poser un plan sans sélection puis lui affecter des villageois. Un plan sans bâtisseur ne progresse pas. Un bâtiment en chantier n’offre ni dépôt, ni capacité, ni fonction ; il a une barre de progression. Le plan bloque le terrain ; les unités présentes sont déplacées vers la tuile libre la plus proche. L’eau et les ressources non épuisées interdisent la pose. Annuler un chantier rembourse **75 %** du coût, arrondi à l’entier inférieur par ressource ; sa destruction ne rembourse rien.

Temps indiqués pour un bâtisseur au contact. Avec `n` bâtisseurs simultanés, vitesse totale = **1 + 0,6 × (n − 1)** ; par exemple 2 bâtisseurs finissent en 62,5 % du temps, 4 en environ 36 %. Maximum **4** bâtisseurs utiles par chantier ; les autres attendent. La progression s’arrête sans bâtisseur et reprend sans perte. À la fin, les bâtisseurs deviennent inactifs. Réparation sur ordre par des villageois : même rendement et maximum, un bâtisseur restaure **5 PV/s** ; coût total proportionnel aux PV restaurés, égal à **50 % du coût initial** pour une réparation complète, prélevé progressivement. Sans ressources, réparation en pause et villageois signalés inactifs. Les bâtiments en chantier ne sont pas réparables.

Valeurs initiales dans `src/config/buildings.json` : coûts en nourriture / bois / pierre / fer ; temps en secondes, taille en tuiles. Tous les bâtiments peuvent être construits plusieurs fois sauf l’hôtel de ville initial, unique et non reconstructible.

| Bâtiment | Âge | Coût N / B / P / F | Temps | Taille | PV | Fonction |
|---|---:|---:|---:|---:|---:|---|
| Hôtel de ville initial | I | — | — | 3 × 3 | 2400 | Dépôt universel, 5 places, villageois et âges ; destruction = défaite |
| Maison | I | 0 / 50 / 0 / 0 | 25 | 2 × 2 | 500 | 10 places |
| Camp de bûcherons | I | 0 / 75 / 0 / 0 | 30 | 2 × 2 | 600 | Dépôt bois |
| Camp de mineurs | I | 0 / 75 / 0 / 0 | 30 | 2 × 2 | 600 | Dépôt pierre et fer |
| Moulin | I | 0 / 75 / 0 / 0 | 30 | 2 × 2 | 600 | Dépôt nourriture |
| Ferme | I | 0 / 60 / 0 / 0 | 20 | 3 × 3 | 300 | Nourriture renouvelable, un villageois |
| Caserne | I | 0 / 150 / 0 / 0 | 45 | 3 × 3 | 1200 | Forme soldats, point de ralliement |
| Camp d’armée | I | 0 / 75 / 0 / 0 | 25 | 4 × 4 | 700 | Repos des soldats, terrain traversable |
| Armurerie | II | 0 / 125 / 50 / 0 | 40 | 3 × 3 | 1000 | Recherche améliorations militaires |
| Tour de défense | II | 0 / 75 / 125 / 0 | 50 | 2 × 2 | 1400 | Tir automatique, portée 7, 12 dégâts toutes les 2 s |

Les dépôts peuvent être posés sans distance minimale ou maximale à une ressource, sous réserve des règles générales. L’hôtel de ville n’a plus de niveaux : les âges sont une progression distincte.

## 6. Unités et combat

La caserne forme directement les soldats, sans consommateur civil ni stock d’armes. Chaque caserne a une file FIFO indépendante, avec les mêmes réservation, paiement, annulation, pause de capacité et sortie que l’hôtel de ville (§4). Un point de ralliement est configurable sur terrain accessible : les nouvelles unités y vont ; sans point défini elles rejoignent le camp de repos ou attendent devant la caserne. La place de population est occupée à la sortie et réservée avant celle-ci.

Valeurs initiales `src/config/units.json` :

| Unité | Âge | Coût N / B / P / F | Formation | PV | Attaque / délai | Portée | Vitesse | Rôle |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Villageois | I | 50 / 0 / 0 / 0 | 20 s | 50 | — | — | 1,8 | Récolte, construit, répare ; ne combat pas |
| Lancier | I | 40 / 25 / 0 / 0 | 18 s | 90 | 8 / 1,5 s | 1 | 2,0 | Mêlée bon marché ; ×1,5 contre chevalier |
| Archer | II | 40 / 50 / 0 / 0 | 22 s | 65 | 9 / 1,8 s | 5 | 2,0 | Distance ; fragile |
| Chevalier | II | 60 / 0 / 0 / 40 | 26 s | 150 | 14 / 1,8 s | 1 | 2,3 | Mêlée rapide ; ×1,5 contre archer et bâtiments |

Le chevalier est un combattant à pied, conformément à sa silhouette existante ; le lancier lui apporte un contre-jeu de mêlée clair, sans introduire de cavalerie. Les multiplicateurs s’appliquent aux cibles correspondantes, sans cumul contre une même cible.

Combat automatique : un soldat arrêté cible l’ennemi le plus proche dans `aggroRange`, priorité soldats, villageois, bâtiments. En marche, il respecte son déplacement ; ordre d’attaque sur une cible ennemie : poursuite jusqu’à destruction, sans limite de distance. Il rejoint sa portée plus `combat.reach` puis frappe selon son délai. Une tour terminée cible les soldats puis les villageois ennemis à portée. Une attaque contre un village alerte les soldats au repos dans `combat.defendRadius` ; ils défendent puis regagnent leur camp quand aucun ennemi n’est à portée. Les alliés ne s’attaquent pas et une alliance annule les cibles hostiles. Mort : unité retirée, place libérée ; bâtiment à 0 PV détruit.

Déplacement A* en 8 directions, sans couper les coins, recherche bornée : eau et bâtiments bloquent, mais forêt, roche, filon et camp d’armée sont traversables. Les unités alliées se traversent ; les ennemis se repoussent. Un groupe se répartit sur les tuiles libres proches de sa destination.

**Camps d’armée.** Au repos, chaque soldat rejoint le camp terminé le moins rempli ; sans camp, il attend devant la caserne en bloc compact. Capacité illimitée, au plus `armyCamp.visibleSoldiers` = 8 figurines affichées au prorata des trois types, badge du total. La fiche détaille chaque type et propose « Former des troupes » et « Partir en guerre ». Cette action sélectionne l’armée du camp ; après choix d’une destination, les soldats sortent en colonne à `army.departIntervalMs`, deviennent visibles et restent sur place jusqu’à l’ordre « Rentrer ». Un ralliement explicite prime à la sortie de caserne.

## 7. Progression des âges

Chaque village commence à l’**âge I**. Passage à l’hôtel de ville : action unique en file avec les villageois, coût payé à l’ajout, prérequis vérifiés à l’ajout et à la fin ; si un prérequis disparaît pendant la recherche, elle reste en pause jusqu’à son rétablissement. Annulation et destruction remboursent comme en §4. Un seul passage vers l’âge suivant peut être en file ; pas de retour en arrière. Les bâtiments prérequis doivent être terminés et distincts.

| Âge | Passage depuis l’âge précédent | Déblocages |
|---|---|---|
| I — **Temps des Clairières** | Départ | Villageois, lancier, hôtel de ville, maison, dépôts, ferme, caserne, camp d’armée |
| II — **Temps des Bourgs** | 400 nourriture + 150 bois ; 90 s ; moulin et caserne | Archer, chevalier, armurerie, tour ; amélioration Fer affûté |
| III — **Temps des Marches** | 700 nourriture + 250 fer ; 120 s ; armurerie et tour | Améliorations Mailles rivetées et Traits renforcés |

L’armurerie est un bâtiment de recherche, sans travailleurs ni fabrication d’armes. Une file FIFO par armurerie ; chaque amélioration est unique par village, payable une fois et appliquée à toutes les unités concernées, existantes et futures. Coût payé au lancement en file, remboursement intégral à l’annulation ou destruction ; une recherche déjà en file ailleurs est interdite.

| Amélioration | Âge | Coût N / B / P / F | Durée | Effet |
|---|---:|---:|---:|---|
| Fer affûté | II | 100 / 0 / 0 / 100 | 45 s | +2 attaque aux lanciers et chevaliers |
| Mailles rivetées | III | 150 / 0 / 0 / 150 | 60 s | +20 PV aux lanciers et chevaliers |
| Traits renforcés | III | 100 / 100 / 0 / 100 | 60 s | +2 attaque aux archers |

## 8. Rythme et équilibrage

Cibles de jeu à vérifier par parties. La simulation économique seed 42 de `tests/pacing.test.ts` utilise les trajets et les files, sans pression ennemie ; les chantiers sont confiés explicitement aux villageois. Les résultats ne représentent donc pas encore une partie complète.

| Jalon | Temps visé | Simulé |
|---|---:|---:|
| Installation en âge I : première maison et premiers dépôts | 1–3 min | Maison 28 s ; camps de bûcherons et de mineurs et moulin terminés à 1 min 46 s |
| Passage à l’âge II terminé | 5–8 min | 6 min 54 s |
| Première attaque organisée | 7–10 min | Non simulé ; caserne terminée à 4 min 15,5 s |
| Armée de 15 soldats | 12–16 min | Non simulé |
| Passage à l’âge III terminé | 13–18 min | 15 min 38 s |
| Fin de partie | 15–25 min | Non simulé |

Le coût d’une armée concurrence villageois, maisons et âges pour les ressources et places. Plusieurs casernes permettent de former en parallèle ; les unités ne retirent pas de villageois de l’économie.

## 9. Contrôles et interface

Tactile : glisser un doigt sur le vide déplace la caméra ; pincer zoome (distance 10–90, décor simplifié au-delà d’environ 45). Tap sélectionne unité ou bâtiment ; appui long puis glisser trace un rectangle de sélection, résumé en bas avec désélection. Avec sélection, tap sur sol déplace ; sur source donne l’ordre de récolte aux villageois ; sur plan ou bâtiment endommagé ordonne construction ou réparation ; sur ennemi ordonne l’attaque aux soldats. Les unités non concernées par un ordre contextuel restent sur place. Un tap sur une ferme terminée affecte un villageois sélectionné disponible à la récolte ; les autres restent sur place. Bouton Construire : menu, fantôme vert/rouge, placement puis confirmation ou annulation.

PC : clic gauche sélectionne, glisser trace un rectangle, Maj ajoute ; clic droit donne l’ordre contextuel. Caméra : clic milieu ou droit maintenu, flèches/ZQSD/WASD, bord d’écran en plein écran ; molette zoome sur le curseur. Trackpad : glisser à deux doigts et pincer. Échap ferme/désélectionne, B construit, A ouvre Armée, Espace revient au village, Ctrl+A sélectionne les soldats visibles. Curseur adapté à la cible. Sur grand écran, HUD lisible à taille fixe et panneaux de largeur limitée, de 1280 × 720 à 2560 × 1440 et en fenêtre.

HUD : population vivante / capacité et places réservées ; quatre stocks nourriture, bois, pierre, fer. Bouton **Villageois inactif** avec nombre : sélectionne successivement les villageois sans tâche active et centre la caméra ; un villageois en trajet, récolte, dépôt, construction ou réparation active n’est pas inactif. Boutons Armée, Diplomatie et Construire. Fiches des bâtiments : PV, progression, file et coûts, ralliement pour caserne ; hôtel de ville : villageois et âges ; armurerie : recherches. Panneau Armée : accès aux casernes, files et camps, sans armes en stock. Actions impossibles grisées avec raison. Mini-carte entière : inconnu gris, terrain exploré, bâtiments connus, unités du joueur et zone caméra ; tap pour centrer. Notifications d’attaque et de diplomatie. Panneaux crème et bois, jeu actif pendant leur ouverture.

## 10. IA

Machine à états évaluée toutes les 2 s par village, soumise aux mêmes coûts, temps, vision, files et règles de récolte que le joueur :

1. **ECONOMY** : former et affecter explicitement les villageois aux sources, dépôts, constructions et réparations ; réaffecter les inactifs et sources épuisées. Construire des maisons avant saturation, des dépôts et fermes, puis les prérequis d’âge. Maintenir au moins `minWorkers` villageois et répartir les récolteurs selon les besoins.
2. **MILITARY** : construire caserne et camps, passer les âges, rechercher les améliorations et former des soldats selon personnalité et stocks.
3. **ATTACK** : si puissance d’armée ≥ `attackThreshold` × puissance estimée de la cible connue, attaquer son hôtel de ville ; cible faible ou proche selon personnalité.
4. **DEFEND** : si un ennemi menace le village, les soldats défendent.

Personnalités `src/config/ai.json` : agressive (caserne tôt, seuil d’attaque bas, alliances rares), économe (production et armée importantes avant attaque), diplomate (alliances et dons fréquents, aucune attaque contre un allié). Puissance = somme des PV × attaque des soldats.

Simulation automatique (seed 42, six villages, joueur passif, pas logique de 100 ms, 15 min simulées) : premier âge II à **6 min 54 s**, première attaque ordonnée à **8 min 00 s** ; maximum observé de 12 villageois dans un village IA et 77 soldats IA au total. Temps moyen mesuré : **2,05 ms par tick** sur la machine de test. La simulation poursuit les systèmes après la défaite du joueur afin de couvrir les 15 minutes ; en jeu, la boucle s’arrête à la fin de partie.

## 11. Diplomatie et fin

Vers chaque village IA découvert : proposer une alliance (acceptée si `baseAcceptance[personnalité] + (ta puissance / sa puissance) × 0,3 − relationsNégatives > 0,5`), envoyer des ressources par convoi pour améliorer la relation, demander des ressources à un allié disposant de plus de deux fois ses besoins, demander 30 % de son armée en renfort, ou rompre l’alliance. Les alliés ne s’attaquent pas.

Victoire lorsque tous les hôtels de ville ennemis sont détruits. Si seuls des alliés restent, une alerte finale rompt les alliances : « Il ne peut en rester qu’un ». Hôtel de ville détruit : village éliminé (`village:destroyed`), ses soldats et bâtiments restants restent sur la carte ; destruction du sien = défaite. Écran final : durée, unités formées, ressources récoltées, villages détruits ; en victoire, une à trois étoiles selon la durée. Écran titre avec nouvelle partie et reprise ; sauvegarde automatique locale périodique et en arrière-plan, effacée à la fin. Menu pause : reprendre, vitesse ×1 / ×2, recommencer ou revenir au menu principal.

## 12. Performance et périmètre

Cible mobile : chunks, instanciation du terrain et des ressources, LOD et animations réduites au dézoom ; mesurer la scène et respecter les budgets de `docs/ART_DIRECTION_CODEX.md`. Les villageois réellement actifs restent simulés et visibles, sans plafond arbitraire de 14 ; optimisation du rendu sans production cachée. Les soldats au repos peuvent être représentés par le résumé de camp décrit en §6.

Hors périmètre initial : multijoueur, campagne, pêche, cavalerie, chaîne de fonte, plusieurs cartes prédéfinies, monétisation et arbre technologique étendu au-delà des âges et améliorations ci-dessus. Bonus si temps : sons, animations de combat, tutoriel et vitesse ×2.
