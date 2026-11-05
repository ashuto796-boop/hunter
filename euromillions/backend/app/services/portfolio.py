"""Portefeuilles de grilles : contraintes, métriques et état incrémental.

Fonction objectif (à maximiser), documentée dans docs/STRATEGIES.md :

    F = w_div·D + w_pairs·Cp + w_triples·Ct + w_stars·E − w_pop·Pop − w_overlap·R − 10·Dup

* D   : diversité = 1 − similarité moyenne entre grilles, la similarité de deux
        grilles étant (numéros communs + étoiles communes) / 7 ;
* Cp  : couverture des paires = paires distinctes / min(1225, 10·n) ;
* Ct  : couverture des triplets = triplets distincts / min(19600, 10·n) ;
* E   : répartition des étoiles = ½ (couverture des paires d'étoiles + équilibre d'usage) ;
* Pop : indice heuristique moyen de motif populaire (0 à 1) ;
* R   : part des couples de grilles dépassant le recouvrement maximal autorisé ;
* Dup : part de doublons (toujours éliminés).

Tous les termes sont dans [0, 1]. **F n'est pas une probabilité de gain** :
chaque grille a la même probabilité 1/139 838 160 de remporter le jackpot.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from math import comb
from typing import Any, Iterable, Sequence

import numpy as np

from app.core.grid import grid_index, numbers_to_mask
from app.core.probability import match_probability, total_combinations
from app.core.rules import CURRENT_TIERS
from app.services.popularity import pattern_score

N_PAIRS = comb(50, 2)  # 1225
N_TRIPLES = comb(50, 3)  # 19600
N_STAR_PAIRS = comb(12, 2)  # 66

_C1 = [comb(v, 1) for v in range(51)]
_C2 = [comb(v, 2) for v in range(51)]
_C3 = [comb(v, 3) for v in range(51)]
_PAIR_POS = [(i, j) for i in range(5) for j in range(i + 1, 5)]
_TRIPLE_POS = [(i, j, k) for i in range(5) for j in range(i + 1, 5) for k in range(j + 1, 5)]


@dataclass
class Weights:
    diversity: float = 0.35
    pairs: float = 0.25
    triples: float = 0.10
    stars: float = 0.15
    popularity: float = 0.10
    overlap: float = 0.05

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "Weights":
        w = Weights()
        for k, v in (d or {}).items():
            if hasattr(w, k):
                fv = float(v)
                if not 0 <= fv <= 10:
                    raise ValueError(f"Pondération {k} hors bornes [0, 10].")
                setattr(w, k, fv)
        return w

    def as_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass
class GridConstraints:
    """Contraintes personnalisées (strictes) appliquées à chaque grille."""

    sum_min: int | None = None
    sum_max: int | None = None
    even_min: int | None = None
    even_max: int | None = None
    max_consecutive_pairs: int | None = None
    max_per_decade: int | None = None
    exclude_numbers: list[int] = field(default_factory=list)
    exclude_stars: list[int] = field(default_factory=list)
    max_popularity: float | None = None
    max_common_numbers: int | None = None  # entre deux grilles du portefeuille (géré par l'objectif)

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "GridConstraints":
        c = GridConstraints()
        for k, v in (d or {}).items():
            if hasattr(c, k) and v is not None:
                setattr(c, k, v)
        if any(not 1 <= n <= 50 for n in c.exclude_numbers):
            raise ValueError("Numéros exclus hors bornes.")
        if any(not 1 <= s <= 12 for s in c.exclude_stars):
            raise ValueError("Étoiles exclues hors bornes.")
        if len(set(c.exclude_numbers)) > 45:
            raise ValueError("Trop de numéros exclus : il doit en rester au moins 5.")
        if len(set(c.exclude_stars)) > 10:
            raise ValueError("Trop d'étoiles exclues : il doit en rester au moins 2.")
        if c.max_common_numbers is not None and not 0 <= c.max_common_numbers <= 4:
            raise ValueError("Le recouvrement maximal doit être compris entre 0 et 4 numéros.")
        return c

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_empty(self) -> bool:
        return all(
            getattr(self, k) in (None, [])
            for k in ("sum_min", "sum_max", "even_min", "even_max", "max_consecutive_pairs", "max_per_decade",
                      "exclude_numbers", "exclude_stars", "max_popularity")
        )

    def accepts(self, numbers: Sequence[int], stars: Sequence[int], pop: float | None = None) -> bool:
        s = sum(numbers)
        if self.sum_min is not None and s < self.sum_min:
            return False
        if self.sum_max is not None and s > self.sum_max:
            return False
        if self.even_min is not None or self.even_max is not None:
            ev = sum(1 for n in numbers if n % 2 == 0)
            if self.even_min is not None and ev < self.even_min:
                return False
            if self.even_max is not None and ev > self.even_max:
                return False
        if self.max_consecutive_pairs is not None:
            ns = sorted(numbers)
            if sum(1 for a, b in zip(ns, ns[1:]) if b == a + 1) > self.max_consecutive_pairs:
                return False
        if self.max_per_decade is not None:
            dec: dict[int, int] = {}
            for n in numbers:
                dec[(n - 1) // 10] = dec.get((n - 1) // 10, 0) + 1
            if max(dec.values()) > self.max_per_decade:
                return False
        if self.exclude_numbers and set(numbers) & set(self.exclude_numbers):
            return False
        if self.exclude_stars and set(stars) & set(self.exclude_stars):
            return False
        if self.max_popularity is not None:
            if pop is None:
                pop = pattern_score(numbers)
            if pop > self.max_popularity:
                return False
        return True


@dataclass(frozen=True)
class GridFeatures:
    numbers: tuple[int, ...]
    stars: tuple[int, ...]
    index: int
    mask: int
    pairs: tuple[int, ...]
    triples: tuple[int, ...]
    star_pair: int
    popularity: float


def grid_features(numbers: Sequence[int], stars: Sequence[int],
                  past_draws: frozenset[tuple[int, ...]] | None = None) -> GridFeatures:
    n = tuple(sorted(numbers))
    s = tuple(sorted(stars))
    pairs = tuple(_C1[n[i] - 1] + _C2[n[j] - 1] for i, j in _PAIR_POS)
    triples = tuple(_C1[n[i] - 1] + _C2[n[j] - 1] + _C3[n[k] - 1] for i, j, k in _TRIPLE_POS)
    return GridFeatures(
        numbers=n,
        stars=s,
        index=grid_index(n, s),
        mask=numbers_to_mask(n),
        pairs=pairs,
        triples=triples,
        star_pair=_C1[s[0] - 1] + _C2[s[1] - 1],
        popularity=pattern_score(n, past_draws),
    )


class PortfolioState:
    """État incrémental d'un portefeuille : chaque remplacement de grille coûte O(1)
    (hors suivi du recouvrement maximal, en O(n) vectorisé)."""

    def __init__(self, weights: Weights, max_common: int | None = None, track_overlap: bool = True):
        self.w = weights
        self.max_common = max_common
        self.track = track_overlap and max_common is not None
        self.grids: list[GridFeatures] = []
        self.num_count = [0] * 51
        self.star_count = [0] * 13
        self.pair_count = [0] * N_PAIRS
        self.triple_count = [0] * N_TRIPLES
        self.sp_count = [0] * N_STAR_PAIRS
        self.distinct_pairs = 0
        self.distinct_triples = 0
        self.distinct_sp = 0
        self.sum_c2_num = 0
        self.sum_c2_star = 0
        self.pop_sum = 0.0
        self.key_count: dict[int, int] = {}
        self.dups = 0
        self.violations = 0
        self._masks = np.zeros(16, dtype=np.uint64)

    # -- mise à jour élémentaire -------------------------------------------------
    def _add_contrib(self, g: GridFeatures) -> None:
        for x in g.numbers:
            self.sum_c2_num += self.num_count[x]
            self.num_count[x] += 1
        for s in g.stars:
            self.sum_c2_star += self.star_count[s]
            self.star_count[s] += 1
        for p in g.pairs:
            if self.pair_count[p] == 0:
                self.distinct_pairs += 1
            self.pair_count[p] += 1
        for t in g.triples:
            if self.triple_count[t] == 0:
                self.distinct_triples += 1
            self.triple_count[t] += 1
        if self.sp_count[g.star_pair] == 0:
            self.distinct_sp += 1
        self.sp_count[g.star_pair] += 1
        self.pop_sum += g.popularity
        c = self.key_count.get(g.index, 0)
        if c >= 1:
            self.dups += 1
        self.key_count[g.index] = c + 1

    def _remove_contrib(self, g: GridFeatures) -> None:
        for x in g.numbers:
            self.num_count[x] -= 1
            self.sum_c2_num -= self.num_count[x]
        for s in g.stars:
            self.star_count[s] -= 1
            self.sum_c2_star -= self.star_count[s]
        for p in g.pairs:
            self.pair_count[p] -= 1
            if self.pair_count[p] == 0:
                self.distinct_pairs -= 1
        for t in g.triples:
            self.triple_count[t] -= 1
            if self.triple_count[t] == 0:
                self.distinct_triples -= 1
        self.sp_count[g.star_pair] -= 1
        if self.sp_count[g.star_pair] == 0:
            self.distinct_sp -= 1
        self.pop_sum -= g.popularity
        c = self.key_count[g.index]
        if c >= 2:
            self.dups -= 1
        if c == 1:
            del self.key_count[g.index]
        else:
            self.key_count[g.index] = c - 1

    def _overlap_violations_with(self, mask: int, exclude: int | None) -> int:
        n = len(self.grids)
        if n == 0:
            return 0
        ov = np.bitwise_count(self._masks[:n] & np.uint64(mask))
        if exclude is not None:
            ov[exclude] = 0
        return int((ov > self.max_common).sum())

    # -- opérations publiques ------------------------------------------------------
    def append(self, g: GridFeatures) -> None:
        if self.track:
            self.violations += self._overlap_violations_with(g.mask, None)
            if len(self.grids) >= self._masks.size:
                self._masks = np.concatenate([self._masks, np.zeros(self._masks.size, dtype=np.uint64)])
            self._masks[len(self.grids)] = np.uint64(g.mask)
        self.grids.append(g)
        self._add_contrib(g)

    def pop_last(self) -> GridFeatures:
        g = self.grids.pop()
        self._remove_contrib(g)
        if self.track:
            self.violations -= self._overlap_violations_with(g.mask, None)
        return g

    def replace(self, i: int, g: GridFeatures) -> GridFeatures:
        old = self.grids[i]
        if self.track:
            self.violations += self._overlap_violations_with(g.mask, i) - self._overlap_violations_with(old.mask, i)
            self._masks[i] = np.uint64(g.mask)
        self._remove_contrib(old)
        self.grids[i] = g
        self._add_contrib(g)
        return old

    def contains(self, index: int) -> bool:
        return index in self.key_count

    # -- métriques ---------------------------------------------------------------
    def components(self) -> dict[str, float]:
        n = len(self.grids)
        if n == 0:
            return {"diversity": 0.0, "pair_coverage": 0.0, "triple_coverage": 0.0, "star_score": 0.0,
                    "star_pair_coverage": 0.0, "star_balance": 0.0, "popularity": 0.0, "overlap_rate": 0.0,
                    "duplicate_rate": 0.0}
        npairs = n * (n - 1) / 2
        diversity = 1 - (self.sum_c2_num + self.sum_c2_star) / (7 * npairs) if n > 1 else 1.0
        ideal = 2 * n / 12
        tvd = sum(abs(self.star_count[s] - ideal) for s in range(1, 13)) / (4 * n)
        star_balance = 1 - tvd / (10 / 12)
        sp_cov = self.distinct_sp / min(N_STAR_PAIRS, n)
        return {
            "diversity": diversity,
            "pair_coverage": self.distinct_pairs / min(N_PAIRS, 10 * n),
            "triple_coverage": self.distinct_triples / min(N_TRIPLES, 10 * n),
            "star_pair_coverage": sp_cov,
            "star_balance": star_balance,
            "star_score": 0.5 * (sp_cov + star_balance),
            "popularity": self.pop_sum / n,
            "overlap_rate": (self.violations / npairs) if (self.track and n > 1) else 0.0,
            "duplicate_rate": self.dups / n,
        }

    def objective(self) -> float:
        c = self.components()
        w = self.w
        return (
            w.diversity * c["diversity"]
            + w.pairs * c["pair_coverage"]
            + w.triples * c["triple_coverage"]
            + w.stars * c["star_score"]
            - w.popularity * c["popularity"]
            - w.overlap * c["overlap_rate"]
            - 10 * c["duplicate_rate"]
        )


def build_state(grids: Iterable[GridFeatures], weights: Weights, max_common: int | None,
                track_overlap: bool = True) -> PortfolioState:
    st = PortfolioState(weights, max_common, track_overlap)
    for g in grids:
        st.append(g)
    return st


# ---------------------------------------------------------------------------
# Métriques complètes (rapport)
# ---------------------------------------------------------------------------


def portfolio_metrics(
    grids: Sequence[tuple[Sequence[int], Sequence[int]]],
    weights: Weights | None = None,
    max_common: int | None = 2,
    include_matrix: bool = True,
    ticket_price: float | None = None,
) -> dict[str, Any]:
    """Métriques descriptives d'un portefeuille (aucune n'est une probabilité de sortie)."""
    weights = weights or Weights()
    feats = [grid_features(n, s) for n, s in grids]
    n = len(feats)
    st = build_state(feats, weights, max_common, track_overlap=n <= 3000)
    comp = st.components()
    out: dict[str, Any] = {
        "n_grids": n,
        "distinct_grids": len(st.key_count),
        "duplicates": st.dups,
        "objective": st.objective() if n else None,
        "weights": weights.as_dict(),
        "max_common_numbers": max_common,
        **comp,
        "distinct_numbers": sum(1 for x in range(1, 51) if st.num_count[x] > 0),
        "distinct_stars": sum(1 for s in range(1, 13) if st.star_count[s] > 0),
        "distinct_pairs": st.distinct_pairs,
        "distinct_triples": st.distinct_triples,
        "distinct_star_pairs": st.distinct_sp,
        "number_usage": st.num_count[1:],
        "star_usage": st.star_count[1:],
        "mean_common_numbers": (st.sum_c2_num / (n * (n - 1) / 2)) if n > 1 else 0.0,
        "mean_common_stars": (st.sum_c2_star / (n * (n - 1) / 2)) if n > 1 else 0.0,
    }
    if n > 1:
        masks = np.array([g.mask for g in feats], dtype=np.uint64)
        smasks = np.array([numbers_to_mask(g.stars) for g in feats], dtype=np.uint64)
        hist = np.zeros(6, dtype=np.int64)
        max_ov = 0
        max_total = 0
        chunk = max(1, 4_000_000 // n)
        for start in range(0, n, chunk):
            block = masks[start:start + chunk]
            ov = np.bitwise_count(block[:, None] & masks[None, :]).astype(np.int8)
            so = np.bitwise_count(smasks[start:start + chunk][:, None] & smasks[None, :]).astype(np.int8)
            rows = np.arange(start, start + block.size)
            upper = np.arange(n)[None, :] > rows[:, None]
            vals = ov[upper]
            hist += np.bincount(vals, minlength=6)[:6]
            if vals.size:
                max_ov = max(max_ov, int(vals.max()))
                max_total = max(max_total, int((ov + so)[upper].max()))
        out["overlap_histogram"] = [{"common_numbers": k, "pairs_of_grids": int(hist[k])} for k in range(6)]
        out["max_common_numbers_observed"] = max_ov
        out["max_common_total_observed"] = max_total
        if max_common is not None:
            out["pairs_over_limit"] = int(hist[max_common + 1:].sum())
        if include_matrix and n <= 100:
            ov = np.bitwise_count(masks[:, None] & masks[None, :]).astype(np.int16)
            so = np.bitwise_count(smasks[:, None] & smasks[None, :]).astype(np.int16)
            sim = (ov + so) / 7.0
            out["similarity_matrix"] = np.round(sim, 4).tolist()
    else:
        out["overlap_histogram"] = []
        out["max_common_numbers_observed"] = 0
        out["max_common_total_observed"] = 0
    out["probabilities"] = portfolio_probability_summary(len(st.key_count))
    if ticket_price is not None:
        out["cost"] = round(n * ticket_price, 2)
    out["disclaimer"] = (
        "Ces scores mesurent la diversification et la couverture du portefeuille. Ce ne sont pas des probabilités "
        "de gain : chaque grille a exactement la même chance de remporter le jackpot."
    )
    return out


def portfolio_probability_summary(n_distinct: int) -> dict[str, Any]:
    from app.core.probability import probability_payload, portfolio_jackpot_probability

    tiers = []
    for t in CURRENT_TIERS:
        p = match_probability(t.numbers, t.stars)
        tiers.append({"rank": t.rank, "label": t.label, "expected_wins": float(p * n_distinct),
                      "single_grid_probability": probability_payload(p)})
    return {
        "jackpot": probability_payload(portfolio_jackpot_probability(n_distinct)),
        "total_combinations": total_combinations(),
        "expected_wins_by_rank": tiers,
        "note": (
            "P(jackpot) = N/139 838 160 est exacte pour N grilles distinctes. Les nombres espérés de gains par rang "
            "sont exacts (linéarité de l'espérance) ; la probabilité d'au moins un gain à un rang dépend des "
            "recouvrements entre grilles : voir l'analyse exacte du portefeuille."
        ),
    }
