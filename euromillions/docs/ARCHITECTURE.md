# Architecture technique

## Vue d'ensemble

| Couche | Technologies | Rôle |
|---|---|---|
| Interface | React 19, TypeScript 5.9, Vite 7, Tailwind 3.4, shadcn/ui (Radix), Recharts 3, TanStack Query, lucide | 19 pages en français, thème sombre, graphiques interactifs |
| API | FastAPI, Pydantic 2 | 91 endpoints REST validés, documentation OpenAPI `/api/docs` |
| Calcul | NumPy 2, SciPy, pandas, scikit-learn, OR-Tools CP-SAT | Statistiques, simulations vectorisées, optimisation, IA |
| Données | SQLAlchemy 2, Alembic, SQLite (local) / PostgreSQL | Persistance, migrations |
| Déploiement | Docker, Docker Compose, nginx | Images backend et frontend, proxy `/api` |

Choix : l'architecture React + FastAPI a été retenue directement (pas de version Streamlit) car elle permet des
tâches longues non bloquantes, une API réutilisable et une interface riche.

## Organisation du backend

```
app/
├── core/                 Moteur mathématique pur (aucune dépendance base/API)
│   ├── rules.py          Époques de règles (9/11/12 étoiles, jours de tirage), 13 rangs, rang ← (k, s)
│   ├── probability.py    Probabilités exactes (Fraction), formats d'affichage, formules portefeuille/tirages
│   ├── grid.py           Validation, tri, masques binaires, numération combinatoire (rang colex bijectif)
│   ├── combinatorics.py  Tables NumPy des 2 118 760 combinaisons (valeurs + masques uint64), en cache
│   └── rng.py            secrets.SystemRandom ou générateurs à graine (random / PCG64)
├── services/             Logique métier (fonctions pures + quelques accès base)
├── api/                  Routes FastAPI (validation Pydantic, sérialisation, tâches de fond)
├── models.py             Modèles SQLAlchemy
├── schemas.py            Schémas d'entrée Pydantic (extra="forbid", bornes strictes)
├── security.py           Clé d'API, limitation de débit
└── main.py               Application, gestion d'erreurs (messages en français), en-têtes de sécurité
```

## Schéma de base de données

| Table | Contenu | Contraintes notables |
|---|---|---|
| `data_sources` | Lot importé : type, emplacement, SHA-256, `is_demo`, compteurs | `kind ∈ {csv, excel, url, manual, demo}` |
| `draws` | Date, époque, 5 numéros triés, 2 étoiles, `stars_max`, jackpot annoncé, source | date unique ; numéros strictement croissants dans 1..50 ; étoiles croissantes ≤ `stars_max` ; `stars_max ∈ {9, 11, 12}` |
| `draw_prizes` | Gagnants et rapport par rang (jamais inventés) | unique (tirage, rang) ; rang 1..13 |
| `portfolios` | Nom, stratégie, paramètres JSON, graine, métriques, prix, analyse exacte en cache | — |
| `grids` | Grilles d'un portefeuille, indice combinatoire | unique (portefeuille, indice) ; bornes |
| `strategies` | Configurations du laboratoire de stratégies | nom unique |
| `simulations` | Paramètres, graine, statut, résultats JSON, durée | statut contrôlé ; `n_draws > 0` |
| `result_checks` / `grid_results` | Vérifications et lignes par grille | correspondances bornées |
| `experiments` | Recherche et IA : hypothèse, mode, période, graine, résultats | `kind`, `mode` contrôlés |
| `reports` | Rapports d'audit | — |
| `settings` | Paramètres modifiables (prix, source du prix…) | clé primaire |

Les types utilisés (Integer, BigInteger, JSON, Date, DateTime TZ) sont portables ; la suite de tests API passe
sur SQLite et sur PostgreSQL 16. Migrations : `alembic revision --autogenerate -m "…"` puis `alembic upgrade head`.

## Algorithmes clés

### Probabilités exactes
P(k numéros, s étoiles) = C(5,k)·C(45,5−k)·C(2,s)·C(S−2,2−s) / (C(50,5)·C(S,2)), calculée en entiers puis en
`Fraction`. Les tests vérifient la somme à 1 pour chaque époque et la concordance avec les cotes officielles.

### Indexation des grilles
Rang colexicographique des numéros (∑ C(nᵢ−1, i)) × 66 + rang des étoiles : bijection exacte entre grilles et
[0, 139 838 160). Sert à l'unicité, aux contraintes `UNIQUE` en base et à l'audit d'uniformité.

### Distributions théoriques exactes
Toute caractéristique d'un tirage (somme, parité, écarts, dizaines, consécutifs) est évaluée sur la table
complète des 2 118 760 combinaisons : la distribution théorique est exacte, sans approximation.

### Analyse exacte d'un portefeuille (`portfolio_exact.py`)
Pour chaque bloc de 262 144 combinaisons de numéros : nombre de bons numéros de chaque grille par
`popcount(masque_tirage & masque_grille)`. Les 66 paires d'étoiles sont traitées en regroupant les grilles
selon qu'elles ont 2, 1 ou 0 bonne étoile ; « au moins un gain au rang r » = OU binaire sur des vecteurs de bits
compactés (`np.packbits` + `uint64`). Le nombre de grilles gagnantes par tirage se calcule comme
`Σᵢ [kᵢ ≥ 2] + Σ_{i : étoiles = paire tirée} [kᵢ = 1]`. Tous les comptages étant entiers, les probabilités sont
exactes. Coût : ~0,5 s pour 1 grille, ~2 s pour 100 grilles. Validé contre une implémentation indépendante.

### État incrémental de portefeuille (`portfolio.py`)
Compteurs d'usage des numéros/étoiles, de paires (1 225), de triplets (19 600) et de paires d'étoiles (66).
Identité utilisée : Σ_{i<j} |Nᵢ ∩ Nⱼ| = Σₓ C(cₓ, 2), donc la similarité moyenne se met à jour en O(1).
Le recouvrement maximal est suivi par popcount vectorisé en O(n). Un remplacement de grille coûte quelques
microsecondes, ce qui permet des dizaines de milliers d'itérations par seconde.

### Simulation Monte-Carlo
Tirage uniforme d'un indice de combinaison (numéros) et d'un indice de paire (étoiles) → masques ; évaluation
vectorisée par blocs (taille adaptée au nombre de grilles), table de correspondance (k, s) → rang.

## Tâches de fond

`services/jobs.py` : pool de threads (taille `EM_MAX_CONCURRENT_JOBS`), file limitée, progression, annulation
coopérative (`threading.Event`), purge des anciennes tâches. NumPy et OR-Tools libèrent le GIL sur les calculs
lourds. Les résultats durables (simulations, expériences, audits, analyses exactes) sont persistés en base.

## Performances mesurées (machine de développement, 4 cœurs)

| Opération | Durée |
|---|---|
| Statistiques complètes sur ~2 000 tirages | < 1,5 s (mises en cache par version des données) |
| 10 000 grilles uniformes | < 1 s |
| Recuit simulé, 10 grilles | ~27 000 itérations/s |
| Monte-Carlo 1 000 000 tirages × 110 grilles | ~2,7 s |
| Analyse exacte, 100 grilles | ~2 s |
| Audit complet (8 vérifications) | ~6 s |

## Sécurité

- Validation stricte de toutes les entrées (Pydantic `extra="forbid"`, bornes), messages d'erreur sans trace.
- ORM paramétré (aucune requête SQL construite par concaténation).
- Import : extensions autorisées, contrôle du contenu (signature ZIP/Excel, octets nuls), taille max, nombre de
  lignes max, protection contre les bombes ZIP (nombre de fichiers et taille décompressée).
- Import par URL : https uniquement, liste blanche d'hôtes, redirections revérifiées, taille limitée (anti-SSRF).
- Exports CSV/Excel protégés contre l'injection de formules.
- Clé d'API optionnelle (comparaison à temps constant), limitation de débit des endpoints coûteux, limites de
  calcul (grilles, tirages simulés, travail total, temps d'optimisation, tâches simultanées).
- En-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` ; CORS restreint.
- Journaux sans données sensibles (type d'exception seulement) ; aucun secret dans le code.
- Conteneur backend exécuté par un utilisateur non privilégié.
- Aucune connexion à un compte de jeu, aucune mise automatisée.
