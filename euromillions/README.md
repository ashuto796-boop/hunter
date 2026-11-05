# EuroMillions Quantum Analytics

Application d'analyse statistique de l'EuroMillions : import et contrôle de l'historique, statistiques
descriptives et tests rigoureux, génération de grilles, optimisation de portefeuilles, simulations Monte-Carlo,
calcul **exact** des probabilités de portefeuille, budget, jackpot, laboratoire IA, mode recherche et audit
mathématique. Interface web entièrement en français.

> **Règle fondamentale.** Pour un tirage équitable, chaque grille valide a exactement la même probabilité de
> remporter le jackpot : **1 sur 139 838 160** (= C(50,5) × C(12,2)). Aucun score de ce logiciel n'est une
> probabilité de sortie : les scores mesurent la diversification, la couverture ou des motifs de grilles.
> Les statistiques historiques sont descriptives et n'ont aucune valeur prédictive démontrée.

---

## Sommaire

1. [Démarrage rapide](#démarrage-rapide)
2. [Fonctionnalités](#fonctionnalités)
3. [Architecture](#architecture)
4. [Installation locale détaillée](#installation-locale-détaillée)
5. [Docker](#docker)
6. [Variables d'environnement](#variables-denvironnement)
7. [Tests](#tests)
8. [Données : réelles et de démonstration](#données--réelles-et-de-démonstration)
9. [Documentation complémentaire](#documentation-complémentaire)
10. [Arborescence](#arborescence)
11. [Avertissement](#avertissement)

---

## Démarrage rapide

### Avec Docker (recommandé pour un serveur)

```bash
cd euromillions
cp .env.example .env          # facultatif : ajustez les valeurs
docker compose up -d --build
# Interface : http://localhost:8080   ·   Documentation API : http://localhost:8080/api/docs
```

### Sans Docker (développement local)

Prérequis : Python 3.11+ (testé en 3.12 et 3.13), Node.js 20.19+ ou 22+.

```bash
cd euromillions
make install        # crée .venv, installe le backend et le frontend
make api            # terminal 1 : API sur http://127.0.0.1:8000 (docs : /api/docs)
make web            # terminal 2 : interface sur http://localhost:5173
```

Sans `make` :

```bash
# Backend
cd euromillions
python3 -m venv .venv && . .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r backend/requirements-dev.txt
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend (autre terminal)
cd euromillions/frontend
npm ci
npm run dev
```

Puis ouvrez **Historique des tirages** et importez l'historique officiel (CSV/Excel/ZIP FDJ) — ou chargez le
jeu de **démonstration fictif** pour explorer l'application.

### Un seul processus (API + interface compilée)

```bash
cd euromillions/frontend && npm ci && npm run build
cd ../backend && EM_FRONTEND_DIST=../frontend/dist uvicorn app.main:app --port 8000
# http://127.0.0.1:8000
```

---

## Fonctionnalités

| Domaine | Ce qui est fourni |
|---|---|
| **Moteur mathématique** | Probabilités exactes (fractions) des 13 rangs, 4 formats d'affichage (fraction, %, scientifique, « 1 chance sur N »), règles par époque (9, 11 puis 12 étoiles), P(jackpot) pour N grilles et T tirages, indexation combinatoire bijective des 139 838 160 grilles. |
| **Import** | CSV (`;` `,` tabulation), Excel, ZIP (format FDJ), URL **https** d'un hôte autorisé ; détection des doublons et conflits, contrôle des dates, bornes et jours de tirage, validation des étoiles **selon l'époque**, rapport ligne par ligne, empreinte SHA-256, date de dernière actualisation. Aucun tirage n'est inventé. |
| **Statistiques** | Fréquences (globales et fenêtres 20/50/100/500), écarts à l'attendu, z, p et q-valeurs (Benjamini-Hochberg), chauds/froids avec avertissement, retards et distribution géométrique, paires/triplets/cooccurrences (carte thermique), paires d'étoiles (Poisson-binomiale exacte), parité, sommes, dizaines, écarts, consécutifs, répétitions, entropie (référence simulée), courbes cumulées, tests du khi-deux corrigés (tirage sans remise) et correction pour comparaisons multiples. |
| **Générateur** | 1 à 10 000 grilles, `secrets.SystemRandom` ou graine reproductible, unicité garantie, contraintes (somme, parité, consécutifs, dizaines, exclusions, indice de motif), stratégies **A à F**, actions copier / sauvegarder / supprimer / regénérer / exporter / comparer. |
| **Optimisation** | Glouton, recherche locale, recuit simulé, tabou, génétique, **OR-Tools CP-SAT** ; fonction objectif documentée et commune ; état incrémental O(1) ; comparaison des méthodes (même graine, même budget), candidats, convergence, matrice de similarité. |
| **Analyse exacte de portefeuille** | Énumération des 139 838 160 tirages (popcount 64 bits + vecteurs de bits) : P(≥ 1 gain) par rang, meilleur rang, distribution du nombre de grilles gagnantes — en tenant compte des **dépendances** entre grilles. 100 grilles ≈ 2 s. |
| **Monte-Carlo** | Jusqu'à 5 millions de tirages, nombres aléatoires communs entre portefeuilles, IC de Wilson à 99 %, hypothèses de gains, distribution des gains nets, progression et annulation. |
| **Budget & jackpot** | Grilles finançables, coût annuel, probabilités sur la durée, bornes exactes des gains secondaires, courbe coût/probabilité, espérance (jackpot / autres rangs / nette) avec partage de Poisson et sensibilité. |
| **Laboratoire IA** | Régression logistique, forêt aléatoire, gradient boosting, MLP, modèle temporel EWMA, règles « chauds » et « retard » contre une référence aléatoire ; séparation chronologique, métriques pré-définies, bootstrap, Bonferroni, échecs publiés. |
| **Mode recherche** | 7 hypothèses, période, graine, simulations sous H0, exploratoire vs **confirmatoire** (refus serveur si la période chevauche une exploration), reproduction à l'identique, export PDF. |
| **Laboratoire de stratégies** | Pondérations en direct, comparaison de 5 stratégies, configurations enregistrées, recherche automatique des paramètres (métrique structurelle, sans données historiques). |
| **Comparateur** | Deux portefeuilles, dominance critère par critère (sans « meilleur » global), analyse exacte + simulation commune. |
| **Audit** | 8 vérifications automatiques (combinaisons, probabilités, rangs, bijection, uniformité du générateur, contraintes/doublons, calcul exact, convergence Monte-Carlo) et rapport PDF. |
| **Exports** | CSV (protégé contre l'injection de formules), Excel, JSON, PDF (date, paramètres, grilles, statistiques, coût, probabilités, hypothèses, limites). |
| **Vérification** | Grilles contre un tirage importé ou saisi, rang par grille, gain **uniquement** s'il figure dans le barème importé, historique des vérifications. |

Les 19 pages : Accueil, Tableau de bord, Historique, Statistiques des numéros, Statistiques des étoiles,
Analyse des combinaisons, Générateur, Optimiseur, Simulateur, Laboratoire IA, Jackpot, Budget, Mes grilles,
Vérification, Paramètres, Laboratoire de stratégies, Comparateur, Mode recherche, Audit.

---

## Architecture

```
React 19 + TypeScript + Tailwind + shadcn/ui + Recharts  (frontend/, Vite)
        │  /api (JSON)          nginx en production (proxy + fichiers statiques)
        ▼
FastAPI + Pydantic  (backend/app)
        ├── core/        moteur mathématique exact (règles, probabilités, grilles, tables NumPy)
        ├── services/    import, statistiques, génération, optimisation, simulation, calcul exact,
        │                budget, jackpot, résultats, IA, recherche, audit, exports, tâches de fond
        ├── api/         routes REST (91 endpoints documentés sur /api/docs)
        └── models.py    SQLAlchemy 2 → SQLite (local) ou PostgreSQL ; migrations Alembic
```

Les calculs longs (optimisation, simulation, calcul exact, IA, audit) s'exécutent dans un **pool de tâches**
(progression, annulation, limite de concurrence) ; l'interface interroge `/api/jobs/{id}` sans jamais se bloquer.
Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Installation locale détaillée

1. **Backend**
   ```bash
   cd euromillions
   python3 -m venv .venv && . .venv/bin/activate
   pip install -r backend/requirements-dev.txt
   cd backend
   uvicorn app.main:app --reload --port 8000
   ```
   La base SQLite est créée dans `backend/data/euromillions.db` et les migrations Alembic sont appliquées
   automatiquement au démarrage (`EM_AUTO_MIGRATE=true`). Manuellement : `alembic upgrade head`.

2. **Frontend**
   ```bash
   cd euromillions/frontend
   npm ci            # .npmrc active legacy-peer-deps (contournement d'un bug d'arborist npm 10)
   npm run dev       # proxy /api → http://127.0.0.1:8000 (VITE_API_PROXY pour changer)
   ```

3. **Données** : page *Historique* → importer un fichier, une URL autorisée, ou la démonstration fictive.

---

## Docker

```bash
docker compose up -d --build                     # SQLite dans le volume em-data
docker compose logs -f backend
docker compose down                              # arrêt (les données restent dans le volume)
```

Variante **PostgreSQL** (définissez `POSTGRES_PASSWORD` dans `.env`) :

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

- `backend` : image `python:3.12-slim`, utilisateur non privilégié, contrôle de santé, limites CPU/mémoire.
- `frontend` : build Node 22 puis `nginx:1.27-alpine` (port 8080), proxy `/api` vers le backend.
- Derrière un proxy d'entreprise qui intercepte TLS, ajoutez son certificat au build (voir
  [`docs/DEPANNAGE.md`](docs/DEPANNAGE.md)).

---

## Variables d'environnement

Toutes sont préfixées `EM_` (liste complète et valeurs par défaut dans [`.env.example`](.env.example)).

| Variable | Défaut | Rôle |
|---|---|---|
| `EM_DATABASE_URL` | SQLite `backend/data/euromillions.db` | URL SQLAlchemy (`postgresql+psycopg://…` pour PostgreSQL) |
| `EM_AUTO_MIGRATE` | `true` | Applique `alembic upgrade head` au démarrage |
| `EM_API_KEY` | vide | Si défini, l'en-tête `X-API-Key` est exigé (sauf `/api/health`) |
| `EM_CORS_ORIGINS` | ports locaux | Origines autorisées |
| `EM_RATE_LIMIT_PER_MINUTE` | `30` | Limite des endpoints coûteux par client |
| `EM_MAX_UPLOAD_MB` / `EM_MAX_IMPORT_ROWS` | `10` / `100000` | Limites d'import |
| `EM_ALLOWED_IMPORT_HOSTS` | `www.fdj.fr,media.fdj.fr` | Hôtes autorisés pour l'import par URL (https uniquement) |
| `EM_MAX_GRIDS_PER_REQUEST` | `10000` | Grilles par génération |
| `EM_MAX_SIMULATION_DRAWS` / `EM_MAX_SIMULATION_WORK` | `5000000` / `2e9` | Limites Monte-Carlo |
| `EM_MAX_CONCURRENT_JOBS` | `2` | Tâches de fond simultanées |
| `EM_EXACT_PORTFOLIO_MAX_GRIDS` | `100` | Taille max de l'analyse exacte |
| `EM_DEFAULT_TICKET_PRICE` | `2.5` | Prix d'une grille (modifiable dans l'interface) |
| `EM_FRONTEND_DIST` | vide | Sert l'interface compilée depuis l'API |
| `VITE_API_URL` (frontend) | `/api` | URL de l'API pour un déploiement séparé |

Aucun secret n'est présent dans le code ; `.env` est ignoré par git.

---

## Tests

```bash
make test                                  # tout
cd backend && pytest                       # 132 tests (pytest + Hypothesis), ~40 s
cd frontend && npm test                    # Vitest
cd frontend && npx tsc -b --noEmit         # vérification des types
```

Suite backend contre PostgreSQL (base vide dédiée) :

```bash
EM_TEST_DATABASE_URL=postgresql+psycopg://user:mdp@localhost:5432/em_test pytest tests/test_api.py
```

Couverture des exigences : unicité et bornes des grilles (propriétés Hypothesis), absence de doublons,
nombre de combinaisons, probabilités officielles des 13 rangs, rangs par époque, imports invalides rejetés,
changements de règles, convergence des simulations dans des intervalles statistiques, avertissements sur les
stratégies non prédictives, sauvegardes, exports (4 formats), endpoints API, dépendances entre grilles
(calcul exact contre une implémentation indépendante par force brute), reproductibilité par graine,
séparation exploratoire/confirmatoire, clé d'API et limitation de débit.

---

## Données : réelles et de démonstration

- **Réelles** : importez l'historique officiel (par exemple les archives CSV/ZIP publiées par la FDJ). Le format
  FDJ (`date_de_tirage`, `boule_1…5`, `etoile_1…2`, `nombre_de_gagnant_au_rangN…`, `rapport_du_rangN…`) est
  reconnu, ainsi qu'un format générique (`date, n1…n5, e1, e2`). Les gains par rang ne sont affichés que s'ils
  figurent dans le fichier.
- **Démonstration** : `backend/data/demo_tirages_FICTIFS.csv` (1 994 tirages **fictifs**, graine 20040213,
  calendrier réel pour exercer les époques de règles). Chaque ligne porte la mention `DEMO-FICTIF`, l'interface
  affiche un bandeau permanent, et le mélange données fictives / réelles est refusé. Régénération :
  `python backend/scripts/generate_demo_data.py`.

---

## Documentation complémentaire

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, schéma de base, algorithmes, performances, sécurité
- [`docs/API.md`](docs/API.md) — référence des endpoints (OpenAPI interactif : `/api/docs`)
- [`docs/GUIDE_UTILISATEUR.md`](docs/GUIDE_UTILISATEUR.md) — guide page par page
- [`docs/STRATEGIES.md`](docs/STRATEGIES.md) — stratégies A à F, fonction objectif, optimiseurs
- [`docs/LIMITES_STATISTIQUES.md`](docs/LIMITES_STATISTIQUES.md) — hypothèses, tests, limites et pièges
- [`docs/DEPANNAGE.md`](docs/DEPANNAGE.md) — dépannage

---

## Arborescence

```
euromillions/
├── README.md · Makefile · docker-compose.yml · docker-compose.postgres.yml · .env.example
├── docs/                    ARCHITECTURE, API, GUIDE_UTILISATEUR, STRATEGIES, LIMITES_STATISTIQUES, DEPANNAGE
├── backend/
│   ├── Dockerfile · requirements*.txt · pyproject.toml · alembic.ini
│   ├── alembic/versions/0001_schema_initial.py
│   ├── app/
│   │   ├── main.py · config.py · db.py · models.py · schemas.py · security.py
│   │   ├── core/            rules.py · probability.py · grid.py · combinatorics.py · rng.py
│   │   ├── services/        importer · statistics · generator · popularity · portfolio · optimizer
│   │   │                    portfolio_exact · simulation · budget · jackpot · results · ml_lab
│   │   │                    research · audit · strategy_lab · export · jobs · settings_store · demo_data
│   │   └── api/             deps · routes_core · routes_draws · routes_statistics
│   │                        routes_portfolios · routes_analysis
│   ├── data/demo_tirages_FICTIFS.csv
│   ├── scripts/generate_demo_data.py
│   └── tests/               9 fichiers de tests + conftest (moteur, import, stats, générateur, optimiseur,
│                            simulation, calcul exact, modules d'analyse, API)
└── frontend/
    ├── Dockerfile · nginx.conf · package.json · vite.config.ts · tailwind.config.ts · components.json
    └── src/
        ├── main.tsx · App.tsx · index.css
        ├── lib/             api · jobs · format · types · viz · utils
        ├── components/      Layout · GridBalls · GridList · charts · common · forms · ui/ (shadcn)
        ├── pages/           19 pages
        └── test/            Vitest + Testing Library
```

---

## Avertissement

Cet outil est un outil d'**analyse statistique**. Il ne prédit pas les tirages, n'automatise aucune mise et
fonctionne sans compte de jeu. Jouer comporte des risques : endettement, isolement, dépendance.
**Joueurs Info Service : 09 74 75 13 13** (appel non surtaxé).
