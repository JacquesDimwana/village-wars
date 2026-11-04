# Village Wars — direction artistique proposée

## Univers et réalisme

**Village Wars se déroule dans les Marches d’Orneval**, une région médiévale fictive de vallées cultivées, de forêts exploitées et de collines ferrifères. Le ton est humain et sobre : on construit un village de travail avant de lever une armée. L’inspiration vient des techniques rurales et militaires européennes des XIIᵉ–XIVᵉ siècles, sans reprendre d’architecture, de blason ou de récit reconnaissable d’une œuvre existante.

Je conserve les trois royaumes du brouillon comme **régions visuelles, sans effet sur les règles**. Leur nom évoque une culture locale, pas une faction liée à une équipe :

- **Solaire** : terres claires, prairies cultivées, enduits chauds et ardoises bleues.
- **Sauvage** : marches boisées, terre ferrugineuse, bois sombre et toits de chaume.
- **Astral** : hautes terres brumeuses, schistes froids et végétation gris-vert. Le nom renvoie à une tradition locale d’observation du ciel ; la lavande et le violet surnaturels deviennent des accents discrets.

Le rendu vise un **réalisme stylisé** : anatomie humaine plausible, mains et outils légèrement agrandis, volumes simples, textures peintes avec matériaux PBR légers et couleurs désaturées. À la caméra haute sur téléphone de 6 pouces, une silhouette doit être identifiable avant ses détails. Refuser les visages détaillés, la boue photographique, les reflets complexes, les proportions chibi et les contours noirs épais.

## Palette

Couleurs de référence pour les aplats dominants, à ajuster sous la lumière finale. Le minerai conserve des **veines claires anguleuses** dans les trois régions : il ne dépend pas uniquement de sa teinte.

| Élément | Solaire | Sauvage | Astral |
|---|---|---|---|
| Sol / sable | `#B7A483` | `#A18061` | `#99958A` |
| Herbe | `#87966C` | `#7C8960` | `#7F9188` |
| Forêt | `#536D4D` | `#4B6045` | `#526A62` |
| Roche | `#A39F91` | `#8E8275` | `#7E8990` |
| Minerai | `#75675D` | `#70594C` | `#626D76` |
| Eau | `#557E84` | `#526F72` | `#526F80` |
| Toits | `#526C80` | `#80664E` | `#626875` |
| Pierre bâtie | `#C4BAA3` | `#AA9D87` | `#A4ACA9` |

**Six villages :** bleu `#2474C6`, rouge `#C33F38`, jaune `#E4B72F`, violet `#8B55B5`, orange `#DE762D`, rose `#D35D91`. Réserver ces couleurs aux bannières, petits pans de tissu, boucliers, anneaux et marqueurs de carte ; ne pas recolorer des bâtiments entiers. Ajouter à chaque village un motif géométrique distinct : barre, chevron, croix, losange, cercle ou triangle. Vérifier les six couleurs côte à côte sur les trois terrains et en simulation de daltonisme.

## Lumière et ambiance Three.js

Une **fin de matinée légèrement voilée** assure une lecture stable, sans cycle jour/nuit. Point de départ à étalonner sur Android :

- `DirectionalLight` : couleur `#FFF1D9`, intensité **2,0**, position indicative `(40, 65, 30)` ; `HemisphereLight` : ciel `#C5D7E4`, sol `#807966`, intensité **1,0**.
- Ombres douces uniquement pour bâtiments et unités proches ; carte **1024 × 1024**, caméra d’ombre ajustée à la zone visible. Les arbres ne projettent pas d’ombre. Désactiver ou réduire les ombres des unités si le coût mobile est trop élevé.
- `Fog` couleur `#BAC6C3`, début à **55 unités**, fin à **110 unités** : voile discret au-delà de la zone de jeu, sans masquer les ressources. Le brouillard de guerre reste un état distinct et lisible.
- Essai initial : **ACES Filmic**, exposition **1,0**, sortie sRGB. AgX est une alternative si la version de Three.js du projet le prend en charge. Valider les couleurs sur l’appareil cible : les intensités perçues dépendent des matériaux et du renderer.

## Cahier des charges des assets

Budgets **par instance visible**, triangles au LOD utilisé au dézoom maximal. Un matériau et un atlas partagés par famille ; éviter les accessoires en meshes et matériaux séparés.

| Catégorie | Silhouette et budget | Texture et animation |
|---|---|---|
| **Arbres** | Tronc visible, houppier en 2–3 masses ; **300–700 triangles**. Solaire : chêne, peuplier, pommier ; Sauvage : pin, hêtre, bouleau ; Astral : épicéa, bouleau, mélèze. | Atlas végétation **1 024² max** partagé ; statiques, variantes de rotation et d’échelle. Instanciation obligatoire. |
| **Rochers / filons** | Rochers en blocs irréguliers **150–400** ; filon **250–500**, même roche avec 2–3 veines visibles. | Atlas terrain **1 024² max**, statiques et instanciés. |
| **Villageois** | Homme et femme de taille comparable ; tunique, jambes séparées, tête plausible ; **800–1 200** avec outil ou charge. Hache, pioche et panier immédiatement reconnaissables. | Atlas personnages **1 024² max** partagé ; marche, coupe, minage, port et mort. Outils/charges inclus dans un petit nombre de variantes partageant les matériaux. |
| **Chevalier / archer** | Chevalier : casque, bouclier et épée ; archer : profil léger et arme à distance, arbalète si nécessaire pour le modèle prévu par le GDD. **1 200–1 800** chacun. | Même atlas personnages si possible ; marche, attaque, mort. Rig humanoïde et clips réutilisables. |
| **Bâtiments** | **1 000–2 000** chacun ; jusqu’à **3 000** pour l’hôtel de ville. Toitures et entrées orientées vers la caméra ; détails intégrés à la géométrie ou à l’atlas. | Atlas bâtiments **2 048² max** partagé ; statiques, variante de construction simple. |

Silhouettes à exiger pour les bâtiments : **hôtel de ville** plus haut et large, clocher civil et bannière ; **maison** au toit simple ; **camp de bûcherons** ouvert avec rondins ; **carrière** avec blocs et chevalet ; **mine** avec entrée sombre et treuil ; **fonderie** avec cheminée ; **armurerie** avec forge et râtelier ; **caserne** avec cour et bannière ; **tour** haute à plateforme ; **camp d’armée** bas avec tentes et râteliers. Ce dernier est une proposition visuelle : **il n’est pas prévu par le GDD actuel**.

**Budget de scène cible au dézoom :** terrain 150 k, végétation et gisements 150 k, 20 bâtiments 40 k, 100 habitants 120 k, 70 soldats 126 k, marqueurs et marge 100 k : **686 k triangles**, sous le plafond de 800 k. Viser **200 appels de dessin** et garder une marge jusqu’à 300, ombres comprises. Mesurer `renderer.info.render` sur une scène représentative ; l’instanciation du terrain, des arbres et des rochers est indispensable. Les personnages animés doivent être regroupés par rig, matériau et animation, avec LOD ou réduction des animations au dézoom : un atlas seul ne garantit pas leur regroupement en appels de dessin.

## Lisibilité en jeu

- **Civils** : vêtements mats et outil ou charge ; **soldats** : casque et arme levée, avec davantage de couleur d’équipe. Les ressources portées se distinguent par leur forme : fagot long, bloc clair, panier de morceaux sombres.
- **Ouvriers de départ non mobilisables** : tablier clair et petit pictogramme fixe de maison sur leur marqueur ; aucun casque. Cette catégorie est une proposition à valider côté règles : le GDD actuel décrit des habitants mobilisables et ne prévoit pas de civils affichés sur la carte.
- **Sélection** : anneau clair épais sous l’unité, indépendant de la couleur d’équipe ; barre de vie affichée à la sélection ou au combat. Ne pas confondre cet anneau avec le marqueur permanent d’équipe.
- **Tuile épuisée** : retrait du décor, puis terrain d’herbe constructible, conformément au GDD. Un bref effet de poussière peut signaler la transition ; aucune souche permanente ne doit suggérer un obstacle.
- Tester à **100 % de dézoom**, en paysage sur un écran physique de 6 pouces, avec unités superposées, brouillard de guerre et six villages représentés.

## Grille de choix d’un pack

1. **Licence** : CC0 ou licence commerciale gratuite autorisant explicitement modification, redistribution dans le jeu et usage sur Android/web ; conserver la licence et les attributions requises. Écarter tout pack aux droits ambigus.
2. **Fichiers** : glTF/GLB préféré, FBX accepté après test d’export ; géométrie, matériaux et animations accessibles sans outil propriétaire obligatoire.
3. **Personnages** : rig humanoïde cohérent entre variantes ; tester réellement le partage des clips, les outils en main et l’export vers Three.js.
4. **Coût** : compter triangles, matériaux, textures et appels de dessin dans la scène cible ; textures plafonnées aux tailles ci-dessus. Viser **moins de 20 Mo compressés pour le pack initial**, animations comprises, puis mesurer mémoire GPU et temps de chargement.
5. **Cohérence** : silhouettes lisibles de haut, proportions compatibles, palette modifiable et absence d’emblèmes ou d’éléments identifiables d’un univers tiers. Tester un arbre, un bâtiment et les deux soldats ensemble sous la lumière du jeu avant d’adopter le pack.

## Itération terrain photographique

Le terrain est désormais une surface continue par chunk, subdivisée à raison de deux segments par tuile. Les poids des matériaux interpolent les tuiles voisines et le relief discret partage le bruit de WorldGen avec les positions des bâtiments, personnages, ressources et fantômes. Les textures photographiques Poly Haven CC0 sont réduites à 512 px ; leurs couleurs se mélangent à deux échelles. Les tuiles épuisées reconstruisent aussi les chunks voisins si nécessaire. L'eau utilise une profondeur interpolée pour le rivage, des rides animées et une coloration selon la profondeur ; le brouillard de guerre reste appliqué aux deux matériaux. Le ciel est en dégradé et les ombres utilisent PCF doux.

Les arbres CommonTree et Pine du Nature MegaKit utilisent de nouveau leurs géométries et textures, avec rotations, échelles et teintes variables en vue proche. Les LOD fusionnés réduisent la densité au dézoom. Les textures ajoutées occupent environ 1,3 Mo sur disque. La mesure réelle des triangles et draw calls reste indispensable dans `__vw.renderer.info.render` sur une scène chargée et sur mobile ; la densité et le coût des arbres texturés peuvent nécessiter un réglage. Vérifier en priorité les raccords de chunks et les côtes, les pieds des bâtiments et des personnages, les silhouettes d'arbres, le brouillard de guerre et l'épuisement à la frontière d'un chunk.
