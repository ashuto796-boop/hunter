# Référence de l'API

Base : `/api`. Documentation interactive : **`/api/docs`** (Swagger) et `/api/redoc`. Schéma : `/api/openapi.json`.

- Format : JSON. Erreurs : `{"detail": "message en français"}` — 400 (règle métier), 404, 409 (conflit),
  413 (fichier trop gros), 422 (validation), 429 (limite de débit / file pleine), 401 (clé d'API).
- Si `EM_API_KEY` est défini, envoyer l'en-tête `X-API-Key` (sauf `/api/health`).
- **Tâches de fond** : les endpoints coûteux renvoient `{"job": {"id": …, "status": "queued"|"running", …}}`.
  Suivre avec `GET /api/jobs/{id}` (le champ `result` apparaît quand `status = "done"`), annuler avec
  `POST /api/jobs/{id}/cancel`.
- Filtres communs des statistiques : `date_from`, `date_to` (AAAA-MM-JJ), `last_n`, `era` (`E2004`, `E2011`, `E2016`).

## Système, mathématiques, tâches, paramètres

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/health` | État, version, nombre de tirages |
| GET | `/math/rules` | Époques de règles, total des combinaisons, formules |
| GET | `/math/probabilities?era=` | 13 rangs avec probabilités exactes (fraction, %, scientifique, 1 sur N) |
| GET | `/math/portfolio?n_grids=&n_draws=` | P(jackpot) pour N grilles distinctes, sur T tirages (exact si T ≤ 520) |
| POST | `/math/exact-portfolio` | **Tâche** — analyse exacte `{portfolio_id}` ou `{grids}` (≤ 100 grilles) |
| GET | `/jobs`, `/jobs/{id}` | Liste / état d'une tâche |
| POST | `/jobs/{id}/cancel` | Annulation |
| GET / PUT | `/settings` | Paramètres (prix, source du prix, tirages/semaine…) et limites |

## Tirages

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/draws?page=&page_size=&date_from=&date_to=&order=` | Liste paginée |
| GET | `/draws/summary` | Nombre, période, époques, démonstration, dernière actualisation |
| GET | `/draws/sources` | Lots importés (SHA-256, compteurs) |
| GET / DELETE | `/draws/{id}` | Détail / suppression |
| POST | `/draws` | Saisie manuelle `{draw_date, numbers, stars, jackpot_eur?, prizes?}` |
| DELETE | `/draws?confirm=true` | Purge complète |
| POST | `/draws/import/file` | multipart `file` (+ `overwrite`) : CSV, XLSX, ZIP |
| POST | `/draws/import/url` | `{url, overwrite}` — https, hôte autorisé |
| POST | `/draws/import/demo` | Jeu de démonstration **fictif** |

Réponse d'import : `inserted`, `replaced`, `duplicates_skipped`, `rejected`, `issues[{line, level, message}]`,
`columns_detected`, `is_demo`.

## Statistiques

`GET /statistics` (synthèse + tests), `/numbers`, `/stars`, `/hot-cold?kind=&window=&top=`, `/gaps?kind=`,
`/pairs?top=`, `/triples?top=`, `/star-pairs`, `/cooccurrence`, `/parity`, `/sums`, `/decades`, `/spacing`,
`/consecutive`, `/repeats`, `/entropy?n_sim=&seed=&window=`, `/tests`, `/history?values=7,13&kind=`,
`/export?section=numbers|stars|pairs|triples|tests&format=csv|xlsx|json|pdf`.

## Grilles et portefeuilles

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/grids/strategies` | Stratégies A–F et méthodes d'optimisation |
| POST | `/grids/generate` | `{count, strategy, seed?, constraints, weights?, method, time_limit_s, max_common, popularity_threshold, historical_mode, historical_strength}` → `{result}` (A/D/E ≤ 2 000) ou `{job}` |
| POST | `/grids/validate` | Validation, tri, indice, indice de motif |
| POST | `/grids/metrics` | Métriques d'un ensemble de grilles |
| POST | `/grids/export` | Export de grilles non enregistrées (`format`) |
| POST | `/grids/save` | Enregistre une grille dans « Mes grilles individuelles » |
| GET / POST | `/portfolios` | Liste / création `{name, grids[], strategy_code, params, seed, notes, ticket_price}` |
| GET / PATCH / DELETE | `/portfolios/{id}` | Détail (grilles + métriques) / renommage / suppression |
| POST / DELETE | `/portfolios/{id}/grids[/{grid_id}]` | Ajout / suppression d'une grille |
| GET | `/portfolios/{id}/export?format=` | CSV, Excel, JSON, PDF |
| POST | `/portfolios/optimize` | **Tâche** — `{n_grids, method, weights, constraints, max_common, time_limit_s, max_iterations, seed, params, budget?}` |
| POST | `/portfolios/compare-methods` | **Tâche** — mêmes paramètres + `methods[]` |
| POST | `/portfolios/candidates` | **Tâche** — portefeuilles candidats (A, B, C, F) |
| POST | `/portfolios/compare` | **Tâche** — `{portfolio_a, portfolio_b, n_draws, seed, exact}` |
| GET / POST / DELETE | `/strategies[/{id}]` | Configurations enregistrées |
| POST | `/strategy-lab/evaluate` | Évaluation synchrone rapide (≤ 100 grilles, ≤ 3 s) |
| POST | `/strategy-lab/compare` | **Tâche** — jusqu'à 5 configurations |
| POST | `/strategy-lab/auto-tune` | **Tâche** — recherche aléatoire de paramètres |

Réponse d'optimisation : `grids`, `objective`, `metrics` (diversité, couvertures, doublons, histogramme des
recouvrements, matrice de similarité…), `iterations`, `elapsed_s`, `seed`, `params`, `history` (convergence),
`status`, `notes`.

## Simulations, résultats, budget, jackpot

| Méthode | Chemin | Description |
|---|---|---|
| POST | `/simulations/run` | **Tâche** — `{portfolio_ids[], inline_portfolios[], random_baselines[], n_draws, seed?, ticket_price?, payouts{rang: €}, jackpot?}` → `simulation_id` |
| GET | `/simulations`, `/simulations/{id}` | Liste / détail (statut, progression, résultats) |
| POST | `/simulations/{id}/cancel` | Annulation |
| DELETE | `/simulations/{id}` | Suppression |
| GET | `/simulations/{id}/export?format=` | Export |
| POST | `/results/check` | `{draw_id | draw_date | numbers+stars, portfolio_id | grids, save}` |
| GET / DELETE | `/results/history[/{id}]` | Historique des vérifications |
| GET | `/budget/probabilities` | `n_grids` ou `budget_per_draw` / `budget_weekly` / `budget_monthly`, `ticket_price`, `draws_per_week`, `duration_weeks`, `assumed_return_rate`, `portfolio_id` |
| GET | `/jackpot/historical-payouts` | Gains moyens par rang issus des données importées (vide si absents) |
| POST | `/jackpot/analysis` | `{jackpot, n_grids, ticket_price?, other_tickets?, expected_other_winners?, popularity_multiplier, secondary_payouts, use_historical_payouts}` |

## Laboratoire IA, recherche, audit

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/ml/models` | Modèles disponibles |
| POST | `/ml/run` | **Tâche** — `{models[], train_ratio, seed?, n_bootstrap, date_from?, date_to?}` |
| GET | `/ml/experiments` | Expériences enregistrées |
| GET | `/research/hypotheses` | Catalogue des hypothèses |
| GET / POST | `/research/experiments` | Liste / lancement **(tâche)** `{hypothesis, mode, date_from, date_to, last_n, n_sim, seed, alpha, params}` ; 409 si un test confirmatoire chevauche une exploration |
| GET / DELETE | `/research/experiments/{id}` | Détail / suppression |
| POST | `/research/experiments/{id}/reproduce` | **Tâche** — rejoue avec la graine enregistrée, `identical: true/false` |
| GET | `/research/experiments/{id}/export?format=pdf|json` | Export |
| POST | `/audit/run` | **Tâche** — audit mathématique |
| GET | `/audit/reports[/{id}]` | Rapports |
| GET | `/audit/reports/{id}/export?format=pdf|json` | Rapport PDF/JSON |

## Exemples

```bash
# Probabilités exactes
curl -s localhost:8000/api/math/probabilities | jq '.tiers[0].probability.one_in'
# 10 grilles uniformes reproductibles
curl -s -X POST localhost:8000/api/grids/generate -H 'Content-Type: application/json' -d '{"count":10,"seed":42}'
# Simulation (tâche de fond)
JOB=$(curl -s -X POST localhost:8000/api/simulations/run -H 'Content-Type: application/json' \
      -d '{"random_baselines":[10],"n_draws":100000,"seed":1}' | jq -r .job.id)
curl -s localhost:8000/api/jobs/$JOB | jq '.status, .progress'
```
