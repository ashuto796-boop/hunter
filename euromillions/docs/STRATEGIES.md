# Stratégies, fonction objectif et optimiseurs

## Ce que les stratégies peuvent — et ne peuvent pas — faire

Pour un tirage équitable, **toutes les grilles ont la même probabilité** de gagner chaque rang. Aucune stratégie
ne modifie la probabilité de gain d'une grille, ni le nombre espéré de gains d'un portefeuille de N grilles
(qui vaut N × p par linéarité de l'espérance).

Ce qu'une stratégie *peut* changer :

- la **structure** du portefeuille : grilles plus ou moins semblables, nombre de paires/triplets distincts couverts ;
- donc la **variance** des résultats : un portefeuille diversifié gagne « plus souvent un peu », un portefeuille
  concentré gagne « plus rarement, plusieurs fois à la fois » — à espérance identique ;
- éventuellement le **partage** d'un gain, *si* certains motifs sont réellement plus joués (non mesurable sans
  données de sélection des joueurs).

## Stratégies A à F

| Code | Nom | Principe | Remarque |
|---|---|---|---|
| A | Aléatoire uniforme | 5 numéros parmi 50 et 2 étoiles parmi 12 tirés uniformément (`secrets.SystemRandom`), doublons rejetés | Référence. Avec contraintes : uniforme parmi les grilles admissibles (rejet). |
| B | Diversification | Optimisation avec poids forts sur la diversité et la pénalité de recouvrement | Recuit simulé (≤ 500 grilles) ou glouton |
| C | Couverture | Optimisation des couvertures de paires, de triplets et de paires d'étoiles | idem |
| D | Popularité estimée | Uniforme parmi les grilles dont l'indice de motif ≤ seuil | La popularité réelle n'est pas connue ; l'indice est heuristique |
| E | Pondération historique | Tirage pondéré sans remise : poids ∝ ((cₓ + 1)/(c̄ + 1))^±a | **Aucun avantage prédictif démontré** ; avertissement systématique |
| F | Multi-objectifs | Vos pondérations + algorithme au choix | Contraintes personnalisées strictes |

## Fonction objectif (à maximiser)

```
F = w_div·D + w_pairs·Cp + w_triples·Ct + w_stars·E − w_pop·Pop − w_overlap·R − 10·Dup
```

| Terme | Définition | Plage |
|---|---|---|
| D — diversité | 1 − similarité moyenne ; similarité(i, j) = (numéros communs + étoiles communes) / 7 | [0, 1] |
| Cp — couverture des paires | paires de numéros distinctes / min(1 225, 10·n) | [0, 1] |
| Ct — couverture des triplets | triplets distincts / min(19 600, 10·n) | [0, 1] |
| E — répartition des étoiles | ½ (paires d'étoiles distinctes / min(66, n) + équilibre d'usage) ; équilibre = 1 − TVD/TVDmax | [0, 1] |
| Pop — motifs | moyenne de l'indice heuristique de motif des grilles | [0, 1] |
| R — recouvrement | part des couples de grilles ayant plus de `max_common` numéros communs | [0, 1] |
| Dup — doublons | part de grilles en double (toujours éliminées) | [0, 1] |

Pondérations par défaut : diversité 0,35 ; paires 0,25 ; triplets 0,10 ; étoiles 0,15 ; motifs 0,10 ;
recouvrement 0,05. **F n'est pas une probabilité** et n'est jamais présentée comme telle.

## Indice heuristique de motif (stratégie D)

Somme plafonnée à 1 de pondérations fixées *par conception* (pas d'estimation statistique) :
tous numéros ≤ 31 (dates) 0,30 ; suite arithmétique 0,35 ; ≥ 3 consécutifs 0,10 (≥ 4 : 0,20) ; ≥ 4 sur une
ligne du bulletin (hypothèse : lignes de 10) 0,15 ; ≥ 3 dans une colonne 0,15 ; ≥ 4 multiples de 5 0,15 ;
reproduction d'un tirage passé 0,30.

## Contraintes personnalisées

Somme min/max, nombre de pairs min/max, paires consécutives max, numéros max par dizaine, numéros et étoiles
exclus, indice de motif max, numéros communs max entre deux grilles. Les contraintes par grille sont **strictes**
(une grille non conforme n'est jamais proposée) ; le recouvrement est géré par la pénalité R (et strictement par
CP-SAT).

## Optimiseurs

Tous partagent l'objectif, le voisinage et l'état incrémental, et renvoient : grilles, objectif, métriques,
doublons, temps, itérations, paramètres, historique de convergence.

| Méthode | Fonctionnement | Paramètres (`params`) |
|---|---|---|
| Glouton | Construit le portefeuille grille par grille : meilleure de k candidates aléatoires | `candidates` |
| Recherche locale | Mouvement aléatoire (changer un numéro ou une étoile) accepté s'il n'aggrave pas F | — |
| Recuit simulé | Accepte une dégradation Δ avec probabilité exp(Δ/T), refroidissement géométrique | `t_initial`, `t_final` |
| Tabou | Meilleur de k voisins ; interdiction de réintroduire l'élément retiré pendant `tenure` pas ; aspiration | `neighbors`, `tenure` |
| Génétique | Population de portefeuilles, sélection par tournoi, croisement par union de grilles, mutation par recherche locale, élitisme | `population`, `mutation_moves` |
| CP-SAT | Programmation par contraintes (OR-Tools) : couverture des paires de numéros et d'étoiles sous contraintes d'équilibre d'usage, de recouvrement (≤ 25 grilles) et contraintes linéaires (somme, parité, dizaines, consécutifs) ; démarrage depuis une solution du recuit ; ≤ 30 grilles | `workers`, `usage_slack`, `hint_share`, `presolve_iterations`, `probing_level` |

Le voisinage biaise la moitié des changements de numéros vers les numéros les moins utilisés du portefeuille,
ce qui accélère la diversification. Le CP-SAT optimise une version linéaire de l'objectif (couvertures) ; sa
solution est ensuite évaluée avec la fonction objectif commune pour une comparaison équitable. Si CP-SAT ne
trouve aucune solution dans le temps imparti, la solution initiale est renvoyée avec le statut `fallback`.

## Recherche automatique de paramètres

Recherche aléatoire sur les pondérations et les températures du recuit, en maximisant une métrique
**structurelle** choisie (couverture des paires, des triplets, diversité, étoiles), avec une diversité minimale
facultative. Aucun tirage historique n'intervient : il n'y a donc pas de risque de « sur-ajustement au passé »
qui donnerait une fausse impression de prédiction.
