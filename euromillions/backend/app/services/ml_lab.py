"""Laboratoire expérimental de machine learning.

Protocole (fixé AVANT l'expérience, identique pour tous les modèles) :

* Cible : pour chaque tirage t et chaque numéro x, y = 1 si x sort au tirage t.
* Variables : calculées uniquement à partir des tirages strictement antérieurs
  à t (fréquences glissantes, retard, apparition au tirage précédent, moyenne
  mobile exponentielle, parité, dizaine) — aucune fuite de données futures.
* Séparation chronologique : les premiers tirages servent à l'entraînement,
  les suivants au test (jamais de mélange aléatoire).
* Métriques pré-définies, évaluées hors échantillon :
  M1 — nombre moyen de bons numéros en jouant les 5 numéros les mieux notés
       (référence exacte sous H0 : 0,5) ;
  M2 — écart de log-loss par rapport à la prédiction constante 0,1 ;
  M3 — AUC (référence 0,5).
* Intervalles de confiance à 95 % par bootstrap sur les tirages de test ;
  correction de Bonferroni sur le nombre de modèles.
* Tous les modèles sont publiés, y compris ceux qui échouent.
"""

from __future__ import annotations

import time
from threading import Event
from typing import Any, Callable

import numpy as np
from scipy import stats as sps

from app.core.rng import np_rng
from app.services.statistics import DrawSet

FEATURE_NAMES = [
    "fréquence 10 derniers", "fréquence 50 derniers", "fréquence 100 derniers", "retard (normalisé)",
    "sorti au tirage précédent", "moyenne mobile exponentielle", "valeur/50", "pair", "dizaine",
]
MODELS = {
    "logistic": "Régression logistique",
    "random_forest": "Forêt aléatoire",
    "gradient_boosting": "Gradient boosting",
    "mlp": "Réseau de neurones (perceptron multicouche)",
    "ewma": "Modèle temporel simple (moyenne mobile exponentielle)",
    "hot": "Règle « numéros chauds » (50 derniers tirages)",
    "overdue": "Règle « numéros en retard »",
    "random": "Référence : choix aléatoire uniforme",
}
WARMUP = 100
HITS_VAR_H0 = 5 * (5 / 50) * (45 / 50) * (45 / 49)  # variance hypergéométrique (N=50, K=5, n=5)


class MLCancelled(Exception):
    pass


def build_features(ds: DrawSet, alpha: float = 0.05) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Retourne X (n_tirages−WARMUP, 50, F), y (n_tirages−WARMUP, 50), indices des tirages."""
    T = ds.size
    if T <= WARMUP + 20:
        raise ValueError(f"Historique insuffisant : au moins {WARMUP + 21} tirages sont nécessaires.")
    x = np.zeros((T, 50), dtype=np.float32)
    x[np.repeat(np.arange(T), 5), ds.numbers.ravel() - 1] = 1
    cum = np.vstack([np.zeros((1, 50), np.float32), np.cumsum(x, axis=0)])  # cum[t] = somme des tirages < t
    gap = np.zeros(50, dtype=np.float32)
    ewma = np.full(50, 0.1, dtype=np.float32)
    values = np.arange(1, 51, dtype=np.float32)
    static = np.stack([values / 50, (values % 2 == 0).astype(np.float32), ((values - 1) // 10) / 4], axis=1)
    feats, ys, idx = [], [], []
    for t in range(T):
        if t >= WARMUP:
            f10 = (cum[t] - cum[t - 10]) / 10
            f50 = (cum[t] - cum[t - 50]) / 50
            f100 = (cum[t] - cum[t - 100]) / 100
            prev = x[t - 1]
            f = np.column_stack([f10, f50, f100, np.minimum(gap, 100) / 100, prev, ewma, static])
            feats.append(f)
            ys.append(x[t])
            idx.append(t)
        # mise à jour avec le tirage t (utilisée seulement pour t+1 et suivants)
        gap = np.where(x[t] > 0, 0, gap + 1)
        ewma = (1 - alpha) * ewma + alpha * x[t]
    return np.array(feats, dtype=np.float32), np.array(ys, dtype=np.float32), np.array(idx)


def _auc(y: np.ndarray, s: np.ndarray) -> float:
    pos = y > 0.5
    n_pos, n_neg = pos.sum(), (~pos).sum()
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    ranks = sps.rankdata(s)
    return float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def _logloss(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def _top5_hits(scores: np.ndarray, y: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Bons numéros par tirage en jouant les 5 meilleurs scores (ex aequo départagés au hasard)."""
    jitter = rng.random(scores.shape) * 1e-9
    top = np.argsort(-(scores + jitter), axis=1)[:, :5]
    return np.take_along_axis(y, top, axis=1).sum(axis=1)


def run_ml_experiment(ds: DrawSet, *, models: list[str] | None = None, train_ratio: float = 0.7,
                      seed: int | None = None, n_bootstrap: int = 1000,
                      progress: Callable[[float, str], None] | None = None,
                      cancel: Event | None = None) -> dict[str, Any]:
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    t0 = time.perf_counter()
    models = models or list(MODELS)
    for m in models:
        if m not in MODELS:
            raise ValueError(f"Modèle inconnu : {m}")
    if "random" not in models:
        models.append("random")
    if not 0.3 <= train_ratio <= 0.9:
        raise ValueError("La part d'entraînement doit être comprise entre 0,3 et 0,9.")
    rng, used_seed = np_rng(seed)
    rs = int(used_seed % (2**31))
    X, Y, idx = build_features(ds)
    n = X.shape[0]
    split = int(n * train_ratio)
    if n - split < 20:
        raise ValueError("Période de test trop courte (moins de 20 tirages).")
    Xtr, Ytr = X[:split].reshape(-1, X.shape[2]), Y[:split].ravel()
    Xte, Yte = X[split:].reshape(-1, X.shape[2]), Y[split:].ravel()
    n_test_draws = n - split
    scaler = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = scaler.transform(Xtr), scaler.transform(Xte)
    base_ll = _logloss(Yte, np.full_like(Yte, 0.1))
    results = []
    for k, name in enumerate(models):
        if cancel is not None and cancel.is_set():
            raise MLCancelled()
        if progress:
            progress(k / len(models), f"Entraînement : {MODELS[name]}")
        tm = time.perf_counter()
        try:
            proba = None
            if name == "logistic":
                proba = LogisticRegression(max_iter=500).fit(Xtr_s, Ytr).predict_proba(Xte_s)[:, 1]
            elif name == "random_forest":
                proba = RandomForestClassifier(n_estimators=150, max_depth=6, min_samples_leaf=50, n_jobs=2,
                                               random_state=rs).fit(Xtr, Ytr).predict_proba(Xte)[:, 1]
            elif name == "gradient_boosting":
                proba = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, max_depth=4,
                                                       random_state=rs).fit(Xtr, Ytr).predict_proba(Xte)[:, 1]
            elif name == "mlp":
                proba = MLPClassifier(hidden_layer_sizes=(32, 16), max_iter=60, early_stopping=True,
                                      random_state=rs).fit(Xtr_s, Ytr).predict_proba(Xte_s)[:, 1]
            elif name == "ewma":
                scores = Xte[:, 5]
            elif name == "hot":
                scores = Xte[:, 1]
            elif name == "overdue":
                scores = Xte[:, 3]
            else:
                scores = rng.random(Yte.shape)
            if proba is not None:
                scores = proba
                ll = _logloss(Yte, proba)
            else:
                ll = None
            S = scores.reshape(n_test_draws, 50)
            Yd = Yte.reshape(n_test_draws, 50)
            hits = _top5_hits(S, Yd, rng)
            auc = _auc(Yte, scores)
            # Bootstrap sur les tirages de test.
            # (AUC : 200 rééchantillonnages, coût de calcul plus élevé.)
            bs_hits, bs_auc, bs_ll = [], [], []
            for b in range(n_bootstrap):
                sel = rng.integers(0, n_test_draws, n_test_draws)
                bs_hits.append(hits[sel].mean())
                if b < 200:
                    bs_auc.append(_auc(Yd[sel].ravel(), S[sel].ravel()))
                if ll is not None:
                    lld = ll.reshape(n_test_draws, 50)[sel].mean() - base_ll.reshape(n_test_draws, 50)[sel].mean()
                    bs_ll.append(lld)
            mean_hits = float(hits.mean())
            z = (hits.sum() - 0.5 * n_test_draws) / np.sqrt(HITS_VAR_H0 * n_test_draws)
            p_one_sided = float(sps.norm.sf(z))
            res = {
                "model": name,
                "label": MODELS[name],
                "status": "ok",
                "m1_mean_hits": mean_hits,
                "m1_baseline": 0.5,
                "m1_ci95": [float(np.percentile(bs_hits, 2.5)), float(np.percentile(bs_hits, 97.5))],
                "m1_p_value_one_sided": p_one_sided,
                "m3_auc": auc,
                "m3_ci95": [float(np.nanpercentile(bs_auc, 2.5)), float(np.nanpercentile(bs_auc, 97.5))],
                "elapsed_s": round(time.perf_counter() - tm, 3),
            }
            if ll is not None:
                res["m2_logloss_delta"] = float(ll.mean() - base_ll.mean())
                res["m2_ci95"] = [float(np.percentile(bs_ll, 2.5)), float(np.percentile(bs_ll, 97.5))]
            else:
                res["m2_logloss_delta"] = None
                res["m2_ci95"] = None
            results.append(res)
        except Exception as exc:  # un échec est publié comme un résultat
            results.append({"model": name, "label": MODELS[name], "status": "error", "error": str(exc)})
    ok = [r for r in results if r["status"] == "ok" and r["model"] != "random"]
    m = max(len(ok), 1)
    for r in ok:
        r["m1_p_bonferroni"] = min(1.0, r["m1_p_value_one_sided"] * m)
        r["beats_random"] = bool(
            r["m1_p_bonferroni"] < 0.05 and r["m3_ci95"][0] > 0.5
            and (r["m2_logloss_delta"] is None or r["m2_ci95"][1] < 0)
        )
    any_beat = any(r.get("beats_random") for r in ok)
    if any_beat:
        conclusion = (
            "Au moins un modèle dépasse la référence aléatoire sur cette période de test selon les critères fixés. "
            "Ce résultat reste exploratoire : il doit être reproduit sur de nouveaux tirages (mode recherche "
            "confirmatoire) avant toute conclusion. Sous l'hypothèse d'un tirage équitable, de tels écarts "
            "apparaissent par hasard de temps à autre."
        )
    else:
        conclusion = (
            "Aucun modèle ne surpasse le hasard de manière statistiquement significative et reproductible sur la "
            "période de test. Ce résultat est cohérent avec des tirages équitables et indépendants : le passé ne "
            "permet pas de prédire le prochain tirage."
        )
    return {
        "seed": used_seed,
        "protocol": {
            "target": "Apparition de chaque numéro (1 à 50) à chaque tirage ; étoiles non modélisées.",
            "features": FEATURE_NAMES,
            "warmup_draws": WARMUP,
            "split": "chronologique",
            "train_draws": split,
            "test_draws": n_test_draws,
            "train_period": [ds.dates[idx[0]].isoformat(), ds.dates[idx[split - 1]].isoformat()],
            "test_period": [ds.dates[idx[split]].isoformat(), ds.dates[idx[-1]].isoformat()],
            "metrics": {
                "M1": "Bons numéros moyens en jouant les 5 numéros les mieux notés (H0 : 0,5).",
                "M2": "Écart de log-loss vs prédiction constante 0,1 (négatif = meilleur).",
                "M3": "AUC (H0 : 0,5).",
            },
            "success_criterion": (
                "Un modèle « bat le hasard » seulement si : p(M1) corrigée Bonferroni < 0,05, IC95 de l'AUC > 0,5 "
                "et, si disponible, IC95 de M2 < 0."
            ),
            "bootstrap": n_bootstrap,
        },
        "results": results,
        "any_model_beats_random": any_beat,
        "conclusion": conclusion,
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
