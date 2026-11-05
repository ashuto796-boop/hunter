# Hypothèses, tests et limites statistiques

## Hypothèse de travail (H0)

Les tirages sont **équitables et indépendants** : à chaque tirage, les C(50,5) combinaisons de numéros et les
C(S,2) paires d'étoiles sont équiprobables, indépendamment du passé. Sous H0, le passé n'apporte **aucune
information** sur le prochain tirage. Les analyses du logiciel décrivent l'historique et testent la cohérence de
H0 ; elles ne prédisent rien.

## Formules de probabilité

| Formule | Hypothèses | Limites |
|---|---|---|
| P(jackpot, 1 grille) = 1/139 838 160 | règles actuelles (5/50 + 2/12) | Avant 2016 : 1/116 531 800 (11 étoiles) puis 1/76 275 360 (9 étoiles) |
| P(jackpot, N grilles distinctes, 1 tirage) = N/139 838 160 | grilles distinctes | Exact car un seul tirage gagnant ; ne vaut pas pour les rangs secondaires |
| P(≥ 1 jackpot en T tirages) = 1 − (1 − N/139 838 160)^T | tirages indépendants, N constant, règles inchangées | Calcul exact (fractions) jusqu'à T = 520, flottant stable (log1p) au-delà |
| Rangs secondaires d'un portefeuille | aucune hypothèse d'indépendance entre grilles | Calcul exact par énumération (≤ 100 grilles) ; Monte-Carlo au-delà |

Les gains de plusieurs grilles d'un **même tirage** ne sont pas indépendants : deux grilles qui partagent des
numéros gagnent souvent ensemble. L'application affiche systématiquement la valeur exacte et, à titre de
comparaison, ce que donnerait l'hypothèse (fausse) d'indépendance.

## Tests utilisés

| Analyse | Test | Particularités |
|---|---|---|
| Uniformité des 50 numéros | Khi-deux, statistique × (K−1)/(K−m) = 49/45 | Les 5 numéros d'un tirage sont distincts (tirage sans remise) : sans correction, le test classique est trop conservateur |
| Uniformité des étoiles | Khi-deux × 11/10, **époque actuelle uniquement** | Mélanger les époques fausserait le test |
| Numéro par numéro | Binomial bilatéral, q-valeurs de Benjamini-Hochberg | 50 tests simultanés |
| Étoile par étoile | Loi de Poisson-binomiale exacte (exposition 2/9, 2/11, 2/12) | Effectif attendu ajusté aux changements de règles |
| Paires (1 225) / triplets (19 600) | Binomial, Benjamini-Hochberg | Un grand nombre de tests produit mécaniquement des p-valeurs faibles |
| Parité, sommes, écarts, dizaines, consécutifs | Khi-deux d'adéquation à la distribution **exacte** (énumération) | Classes d'effectif attendu < 5 regroupées |
| Répétitions entre tirages | Loi hypergéométrique | — |
| Entropie | Référence simulée sous H0 (graine enregistrée) | L'entropie maximale ln(50) n'est pas la bonne référence pour un échantillon fini |
| Synthèse des tests globaux | Benjamini-Hochberg et Bonferroni | Seules les valeurs corrigées sont interprétables |
| Simulations | Intervalles de Wilson à 99 % | L'IC par grille ignore la dépendance entre grilles d'un même tirage : indicatif |

## Pièges à éviter

1. **Confondre écart et prédiction.** Un numéro « chaud » ou « froid » décrit le passé. Sous H0, sa probabilité
   au prochain tirage reste 10 %.
2. **L'erreur du joueur.** Un retard élevé ne rend pas un numéro « dû » : les intervalles d'apparition suivent une
   loi géométrique sans mémoire.
3. **Comparaisons multiples.** Sur 19 600 triplets testés, des centaines de p-valeurs < 5 % apparaissent par pur
   hasard (jusqu'à 5 % des tests, soit environ 980) : seules les valeurs corrigées comptent.
4. **Fouille de données.** Tester de nombreuses hypothèses sur la même période puis retenir la « meilleure »
   produit des faux positifs. D'où le mode **confirmatoire** : une hypothèse, une période jamais explorée pour
   cette hypothèse, un seul test.
5. **Sur-ajustement.** Un modèle d'apprentissage qui « marche » sur l'historique peut échouer sur des tirages
   nouveaux. D'où la séparation chronologique stricte, les métriques fixées à l'avance et la comparaison à une
   référence aléatoire.
6. **Données fictives.** Le jeu de démonstration est uniforme par construction : il ne peut rien « révéler ».

## Laboratoire IA : protocole

- Cible : apparition de chaque numéro à chaque tirage (les étoiles ne sont pas modélisées).
- Variables construites **uniquement** à partir des tirages antérieurs (vérifié par un test automatique).
- Séparation chronologique (70 % / 30 % par défaut), aucun mélange aléatoire.
- Métriques pré-définies : M1 (bons numéros moyens en jouant les 5 meilleurs scores ; 0,5 sous H0),
  M2 (écart de log-loss vs 0,1), M3 (AUC ; 0,5 sous H0).
- Bootstrap sur les tirages de test (IC 95 %), correction de Bonferroni sur le nombre de modèles.
- Critère de succès conjoint (M1 corrigée < 0,05, IC de l'AUC > 0,5, IC de M2 < 0). Même satisfait, le résultat
  reste exploratoire et doit être confirmé sur des tirages postérieurs.
- Tous les modèles sont publiés, y compris les échecs.

## Mode recherche : modèle nul

Pour les hypothèses de sélection (« chauds », « en retard », « tirage précédent »), la distribution nulle est
**exactement hypergéométrique** quel que soit le critère de sélection, car sous H0 le tirage suivant est
indépendant des k numéros choisis. Pour les autres métriques, la distribution nulle est simulée en tirant des
combinaisons uniformes (graine enregistrée, reproductible à l'identique).

## Budget, jackpot et espérance

- Les montants des rangs secondaires varient à chaque tirage (mises, nombre de gagnants) : ce sont des
  **hypothèses** saisies ou des moyennes de l'historique importé, jamais des valeurs inventées.
- Le partage du jackpot suit une loi de Poisson de paramètre λ ; sans données fiables sur la popularité des
  combinaisons, le multiplicateur de popularité vaut 1.
- Le montant annoncé n'est pas un gain garanti. Fiscalité et options annexes ne sont pas modélisées.
- Sans portefeuille précis, la probabilité d'au moins un gain secondaire n'est connue qu'à travers des bornes
  exactes : [p₁, min(1, N·p₁)].
