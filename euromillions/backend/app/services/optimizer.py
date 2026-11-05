"""Moteur d'optimisation combinatoire de portefeuilles.

Toutes les méthodes maximisent la même fonction objectif documentée
(``app.services.portfolio.PortfolioState.objective``), ce qui permet de les
comparer. Cette fonction mesure diversification et couverture : ce n'est en
aucun cas une probabilité de sortie.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from threading import Event
from typing import Any, Callable

from app.core.rng import new_seed
from app.services.portfolio import (
    GridConstraints,
    GridFeatures,
    PortfolioState,
    Weights,
    build_state,
    grid_features,
    portfolio_metrics,
)

METHODS = {
    "greedy": "Heuristique gloutonne",
    "local_search": "Recherche locale (montée de colline)",
    "simulated_annealing": "Recuit simulé",
    "tabu": "Recherche tabou",
    "genetic": "Algorithme génétique",
    "cp_sat": "OR-Tools CP-SAT (programmation par contraintes)",
}

ProgressFn = Callable[[float, str], None]


class OptimizationCancelled(Exception):
    pass


class InfeasibleConstraints(ValueError):
    pass


@dataclass
class OptimizerConfig:
    n_grids: int
    method: str = "simulated_annealing"
    weights: Weights = field(default_factory=Weights)
    constraints: GridConstraints = field(default_factory=GridConstraints)
    max_common: int | None = 2
    time_limit_s: float = 5.0
    max_iterations: int = 200_000
    seed: int | None = None
    params: dict[str, Any] = field(default_factory=dict)
    initial: list[tuple[tuple[int, ...], tuple[int, ...]]] | None = None


@dataclass
class OptimizerResult:
    method: str
    grids: list[tuple[tuple[int, ...], tuple[int, ...]]]
    objective: float
    metrics: dict[str, Any]
    iterations: int
    elapsed_s: float
    seed: int
    params: dict[str, Any]
    history: list[dict[str, float]]
    status: str = "ok"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "method_label": METHODS.get(self.method, self.method),
            "grids": [{"numbers": list(n), "stars": list(s)} for n, s in self.grids],
            "objective": self.objective,
            "metrics": self.metrics,
            "diversity": self.metrics.get("diversity"),
            "pair_coverage": self.metrics.get("pair_coverage"),
            "triple_coverage": self.metrics.get("triple_coverage"),
            "duplicates": self.metrics.get("duplicates"),
            "iterations": self.iterations,
            "elapsed_s": round(self.elapsed_s, 4),
            "seed": self.seed,
            "params": self.params,
            "history": self.history,
            "status": self.status,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
# Échantillonnage et voisinage
# ---------------------------------------------------------------------------


class Sampler:
    def __init__(self, rng: random.Random, constraints: GridConstraints, past: frozenset | None = None):
        self.rng = rng
        self.c = constraints
        self.past = past
        self.numbers = [n for n in range(1, 51) if n not in set(constraints.exclude_numbers)]
        self.stars = [s for s in range(1, 13) if s not in set(constraints.exclude_stars)]
        self._cache: dict[tuple, GridFeatures] = {}

    def features(self, nums: tuple[int, ...], stars: tuple[int, ...]) -> GridFeatures:
        key = (nums, stars)
        f = self._cache.get(key)
        if f is None:
            f = grid_features(nums, stars, self.past)
            if len(self._cache) < 500_000:
                self._cache[key] = f
        return f

    def accepts(self, f: GridFeatures) -> bool:
        return self.c.accepts(f.numbers, f.stars, f.popularity)

    def random_grid(self, max_tries: int = 20_000) -> GridFeatures:
        for _ in range(max_tries):
            nums = tuple(sorted(self.rng.sample(self.numbers, 5)))
            stars = tuple(sorted(self.rng.sample(self.stars, 2)))
            f = self.features(nums, stars)
            if self.c.is_empty or self.accepts(f):
                return f
        raise InfeasibleConstraints(
            "Contraintes trop restrictives : aucune grille valide trouvée après 20 000 essais."
        )

    def neighbor(self, g: GridFeatures, num_count: list[int] | None = None) -> GridFeatures | None:
        """Change un numéro (75 %) ou une étoile (25 %). Retourne None si la grille obtenue est refusée."""
        rng = self.rng
        if rng.random() < 0.75:
            nums = list(g.numbers)
            pos = rng.randrange(5)
            current = set(nums)
            if num_count is not None and rng.random() < 0.5:
                # Biais vers les numéros les moins utilisés du portefeuille (accélère la diversification).
                cand = [x for x in rng.sample(self.numbers, min(8, len(self.numbers))) if x not in current]
                if not cand:
                    return None
                new = min(cand, key=lambda x: num_count[x])
            else:
                new = rng.choice(self.numbers)
                if new in current:
                    return None
            nums[pos] = new
            f = self.features(tuple(sorted(nums)), g.stars)
        else:
            stars = list(g.stars)
            pos = rng.randrange(2)
            new = rng.choice(self.stars)
            if new in stars:
                return None
            stars[pos] = new
            f = self.features(g.numbers, tuple(sorted(stars)))
        if not self.c.is_empty and not self.accepts(f):
            return None
        return f


def _random_portfolio(state: PortfolioState, sampler: Sampler, n: int) -> None:
    tries = 0
    while len(state.grids) < n:
        g = sampler.random_grid()
        if state.contains(g.index):
            tries += 1
            if tries > 100_000:
                raise InfeasibleConstraints("Impossible de trouver suffisamment de grilles distinctes.")
            continue
        state.append(g)


class _Tracker:
    def __init__(self, cfg: OptimizerConfig, progress: ProgressFn | None, cancel: Event | None):
        self.t0 = time.perf_counter()
        self.cfg = cfg
        self.progress = progress
        self.cancel = cancel
        self.history: list[dict[str, float]] = []
        self.best = -math.inf
        self._last_record = -1.0

    @property
    def elapsed(self) -> float:
        return time.perf_counter() - self.t0

    def fraction(self, it: int) -> float:
        return min(1.0, max(self.elapsed / self.cfg.time_limit_s, it / max(self.cfg.max_iterations, 1)))

    def done(self, it: int) -> bool:
        return self.elapsed >= self.cfg.time_limit_s or it >= self.cfg.max_iterations

    def tick(self, it: int, current: float, best: float, force: bool = False) -> None:
        if self.cancel is not None and self.cancel.is_set():
            raise OptimizationCancelled()
        e = self.elapsed
        if force or e - self._last_record >= self.cfg.time_limit_s / 150 or not self.history:
            self.history.append({"iteration": it, "elapsed_s": round(e, 4), "current": current, "best": best})
            self._last_record = e
            if self.progress:
                self.progress(self.fraction(it), f"{METHODS.get(self.cfg.method, self.cfg.method)} : itération {it}")


# ---------------------------------------------------------------------------
# Méthodes
# ---------------------------------------------------------------------------


def _greedy(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int]:
    candidates = int(cfg.params.get("candidates", 30 if cfg.n_grids <= 500 else 6))
    st = PortfolioState(cfg.weights, cfg.max_common, track_overlap=cfg.n_grids <= 3000)
    it = 0
    while len(st.grids) < cfg.n_grids:
        best_g, best_v = None, -math.inf
        for _ in range(candidates):
            g = sampler.random_grid()
            if st.contains(g.index):
                continue
            st.append(g)
            v = st.objective()
            st.pop_last()
            it += 1
            if v > best_v:
                best_g, best_v = g, v
        if best_g is None:
            continue
        st.append(best_g)
        if len(st.grids) % max(1, cfg.n_grids // 100) == 0:
            tr.tick(it, best_v, best_v)
    return st, it


def _init_state(cfg: OptimizerConfig, sampler: Sampler) -> PortfolioState:
    if cfg.initial:
        feats = [sampler.features(tuple(sorted(n)), tuple(sorted(s))) for n, s in cfg.initial]
        st = build_state(feats, cfg.weights, cfg.max_common, track_overlap=cfg.n_grids <= 3000)
        if st.dups:
            raise ValueError("Le portefeuille initial contient des doublons.")
        _random_portfolio(st, sampler, cfg.n_grids)
        return st
    st = PortfolioState(cfg.weights, cfg.max_common, track_overlap=cfg.n_grids <= 3000)
    _random_portfolio(st, sampler, cfg.n_grids)
    return st


def _try_move(st: PortfolioState, sampler: Sampler) -> tuple[int, GridFeatures] | None:
    i = sampler.rng.randrange(len(st.grids))
    g = sampler.neighbor(st.grids[i], st.num_count)
    if g is None or st.contains(g.index):
        return None
    return i, g


def _local_search(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int]:
    st = _init_state(cfg, sampler)
    cur = st.objective()
    it = 0
    while not tr.done(it):
        it += 1
        mv = _try_move(st, sampler)
        if mv is None:
            continue
        i, g = mv
        old = st.replace(i, g)
        v = st.objective()
        if v >= cur:
            cur = v
        else:
            st.replace(i, old)
        if it % 200 == 0:
            tr.tick(it, cur, cur)
    return st, it


def _annealing(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int]:
    st = _init_state(cfg, sampler)
    t0 = float(cfg.params.get("t_initial", 0.02))
    t_end = float(cfg.params.get("t_final", 1e-5))
    if not (t0 > 0 and t_end > 0 and t_end < t0):
        raise ValueError("Températures invalides : 0 < t_final < t_initial requis.")
    cur = st.objective()
    best = cur
    best_grids = list(st.grids)
    it = 0
    while not tr.done(it):
        it += 1
        frac = tr.fraction(it)
        temp = t0 * (t_end / t0) ** frac
        mv = _try_move(st, sampler)
        if mv is None:
            continue
        i, g = mv
        old = st.replace(i, g)
        v = st.objective()
        delta = v - cur
        if delta >= 0 or sampler.rng.random() < math.exp(delta / temp):
            cur = v
            if v > best:
                best = v
                best_grids = list(st.grids)
        else:
            st.replace(i, old)
        if it % 200 == 0:
            tr.tick(it, cur, best)
    final = build_state(best_grids, cfg.weights, cfg.max_common, track_overlap=cfg.n_grids <= 3000)
    return final, it


def _tabu(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int]:
    st = _init_state(cfg, sampler)
    neighbors = int(cfg.params.get("neighbors", 25))
    tenure = int(cfg.params.get("tenure", 15))
    cur = st.objective()
    best = cur
    best_grids = list(st.grids)
    tabu: dict[tuple[int, int], int] = {}
    it = 0
    step = 0
    while not tr.done(it):
        step += 1
        cand: tuple[float, int, GridFeatures, tuple[int, int]] | None = None
        for _ in range(neighbors):
            it += 1
            mv = _try_move(st, sampler)
            if mv is None:
                continue
            i, g = mv
            removed = set(st.grids[i].numbers + tuple(100 + s for s in st.grids[i].stars))
            added = set(g.numbers + tuple(100 + s for s in g.stars)) - removed
            attr = (i, next(iter(added))) if added else (i, -1)
            old = st.replace(i, g)
            v = st.objective()
            st.replace(i, old)
            is_tabu = tabu.get(attr, -1) >= step
            if is_tabu and v <= best:
                continue  # critère d'aspiration : un mouvement tabou n'est accepté que s'il bat le record
            if cand is None or v > cand[0]:
                removed_attr = (i, next(iter(removed - set(g.numbers + tuple(100 + s for s in g.stars))), -1))
                cand = (v, i, g, removed_attr)
        if cand is None:
            continue
        v, i, g, removed_attr = cand
        st.replace(i, g)
        cur = v
        tabu[removed_attr] = step + tenure  # interdit de réintroduire l'élément retiré
        if v > best:
            best = v
            best_grids = list(st.grids)
        if step % 10 == 0:
            tr.tick(it, cur, best)
    final = build_state(best_grids, cfg.weights, cfg.max_common, track_overlap=cfg.n_grids <= 3000)
    return final, it


def _genetic(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int]:
    pop_size = int(cfg.params.get("population", 16))
    mutation_moves = int(cfg.params.get("mutation_moves", max(2, cfg.n_grids // 5)))
    elite = 2
    rng = sampler.rng
    track = cfg.n_grids <= 3000

    def fitness(grids: list[GridFeatures]) -> float:
        return build_state(grids, cfg.weights, cfg.max_common, track).objective()

    population: list[tuple[float, list[GridFeatures]]] = []
    for k in range(pop_size):
        st = _init_state(cfg, sampler) if (k == 0 and cfg.initial) else PortfolioState(cfg.weights, cfg.max_common, track)
        if not st.grids:
            _random_portfolio(st, sampler, cfg.n_grids)
        population.append((st.objective(), list(st.grids)))
    it = 0
    gen = 0
    while not tr.done(it):
        gen += 1
        population.sort(key=lambda x: -x[0])
        nxt = population[:elite]
        while len(nxt) < pop_size:
            a = max(rng.sample(population, 3), key=lambda x: x[0])[1]
            b = max(rng.sample(population, 3), key=lambda x: x[0])[1]
            pool = {g.index: g for g in a + b}
            chosen = rng.sample(list(pool.values()), min(cfg.n_grids, len(pool)))
            st = build_state(chosen, cfg.weights, cfg.max_common, track)
            _random_portfolio(st, sampler, cfg.n_grids)
            cur = st.objective()
            for _ in range(mutation_moves):
                it += 1
                mv = _try_move(st, sampler)
                if mv is None:
                    continue
                i, g = mv
                old = st.replace(i, g)
                v = st.objective()
                if v >= cur:
                    cur = v
                else:
                    st.replace(i, old)
            nxt.append((cur, list(st.grids)))
            it += 1
        population = nxt
        best = max(p[0] for p in population)
        tr.tick(it, best, best)
    population.sort(key=lambda x: -x[0])
    return build_state(population[0][1], cfg.weights, cfg.max_common, track), it


def _cp_sat(cfg: OptimizerConfig, sampler: Sampler, tr: _Tracker) -> tuple[PortfolioState, int, list[str], str]:
    """Modèle CP-SAT : couverture des paires de numéros et d'étoiles sous contraintes.

    Une solution initiale complète (toutes variables, y compris auxiliaires) est fournie par un
    recuit simulé court ; si elle respecte les contraintes, CP-SAT dispose immédiatement d'une
    solution réalisable qu'il cherche à améliorer.
    """
    from ortools.sat.python import cp_model

    n = cfg.n_grids
    max_n = int(cfg.params.get("max_grids", 30))
    if n > max_n:
        raise ValueError(f"CP-SAT est limité à {max_n} grilles dans cette version (modèle à {n}×1225 variables).")
    c = cfg.constraints
    numbers = [v for v in range(1, 51) if v not in set(c.exclude_numbers)]
    stars = [s for s in range(1, 13) if s not in set(c.exclude_stars)]
    mc = min(cfg.max_common if cfg.max_common is not None else 4, 4)
    overlap_pairs = n <= int(cfg.params.get("max_overlap_grids", 25))
    if not overlap_pairs:
        mc = 4

    # 1) Solution initiale.
    hint_share = float(cfg.params.get("hint_share", 0.25))
    hint_weights = Weights(**{**cfg.weights.as_dict(), "overlap": max(cfg.weights.overlap, 3.0)})
    hint_cfg = OptimizerConfig(
        n_grids=n, method="simulated_annealing", weights=hint_weights, constraints=cfg.constraints,
        max_common=mc, time_limit_s=max(0.2, cfg.time_limit_s * hint_share), max_iterations=cfg.max_iterations,
        seed=cfg.seed, params={},
    )
    hint_tr = _Tracker(hint_cfg, None, tr.cancel)
    hint_state, _ = _annealing(hint_cfg, sampler, hint_tr)
    hint = sorted(hint_state.grids, key=lambda gf: gf.numbers)
    hn = [set(g.numbers) for g in hint]
    hs = [set(g.stars) for g in hint]

    m = cp_model.CpModel()

    def bvar(value: bool) -> Any:
        v = m.new_bool_var("")
        m.add_hint(v, bool(value))
        return v

    x = {(g, v): bvar(v in hn[g]) for g in range(n) for v in numbers}
    y = {(g, s): bvar(s in hs[g]) for g in range(n) for s in stars}
    for g in range(n):
        m.add(sum(x[g, v] for v in numbers) == 5)
        m.add(sum(y[g, s] for s in stars) == 2)
        if c.sum_min is not None:
            m.add(sum(v * x[g, v] for v in numbers) >= c.sum_min)
        if c.sum_max is not None:
            m.add(sum(v * x[g, v] for v in numbers) <= c.sum_max)
        evens = sum(x[g, v] for v in numbers if v % 2 == 0)
        if c.even_min is not None:
            m.add(evens >= c.even_min)
        if c.even_max is not None:
            m.add(evens <= c.even_max)
        if c.max_per_decade is not None:
            for d in range(5):
                m.add(sum(x[g, v] for v in numbers if (v - 1) // 10 == d) <= c.max_per_decade)
        if c.max_consecutive_pairs is not None:
            cons = []
            for v in numbers:
                if v + 1 in numbers:
                    b = bvar(v in hn[g] and v + 1 in hn[g])
                    m.add_bool_and([x[g, v], x[g, v + 1]]).only_enforce_if(b)
                    m.add_bool_or([x[g, v].Not(), x[g, v + 1].Not()]).only_enforce_if(b.Not())
                    cons.append(b)
            m.add(sum(cons) <= c.max_consecutive_pairs)
    # Équilibre d'usage (diversité) : chaque numéro/étoile utilisé au plus ⌈5n/|N|⌉ + marge fois.
    hint_num_use = max(sum(1 for g in hn if v in g) for v in numbers)
    hint_star_use = max(sum(1 for g in hs if s in g) for s in stars)
    slack = int(cfg.params.get("usage_slack", 1))
    cap_n = max(math.ceil(5 * n / len(numbers)) + slack, hint_num_use)
    cap_s = max(math.ceil(2 * n / len(stars)) + slack, hint_star_use)
    for v in numbers:
        m.add(sum(x[g, v] for g in range(n)) <= cap_n)
    for s in stars:
        m.add(sum(y[g, s] for g in range(n)) <= cap_s)
    # Recouvrement maximal entre deux grilles (garantit aussi l'unicité si ≤ 4).
    if overlap_pairs:
        hint_max_ov = max((len(hn[g] & hn[h]) for g in range(n) for h in range(g + 1, n)), default=0)
        mc = max(mc, min(hint_max_ov, 4)) if cfg.params.get("relax_to_hint", 1) else mc
        for g in range(n):
            for h in range(g + 1, n):
                common = []
                for v in numbers:
                    b = bvar(v in hn[g] and v in hn[h])
                    m.add_implication(b, x[g, v])
                    m.add_implication(b, x[h, v])
                    m.add_bool_or([x[g, v].Not(), x[h, v].Not(), b])
                    common.append(b)
                m.add(sum(common) <= mc)
    # Couverture des paires de numéros et d'étoiles.
    def coverage(items: list[int], var: dict, hsets: list[set[int]]) -> list[Any]:
        terms = []
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                zs = []
                for g in range(n):
                    z = bvar(a in hsets[g] and b in hsets[g])
                    m.add_implication(z, var[g, a])
                    m.add_implication(z, var[g, b])
                    zs.append(z)
                cov = bvar(any(a in hsets[g] and b in hsets[g] for g in range(n)))
                m.add(cov <= sum(zs))
                terms.append(cov)
        return terms

    pair_terms = coverage(numbers, x, hn)
    sp_terms = coverage(stars, y, hs)
    w_pairs = int(round(10000 * cfg.weights.pairs / min(1225, 10 * n))) or 1
    w_sp = int(round(10000 * cfg.weights.stars / min(66, n))) or 1
    m.maximize(w_pairs * sum(pair_terms) + w_sp * sum(sp_terms))
    # Brise des symétries : grilles ordonnées par plus petit numéro.
    firsts = [_first_number_expr(m, x, g, numbers, min(hn[g])) for g in range(n)]
    for g in range(n - 1):
        m.add(firsts[g] <= firsts[g + 1])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.5, float(cfg.time_limit_s) - hint_tr.elapsed)
    solver.parameters.num_workers = int(cfg.params.get("workers", 4))
    solver.parameters.random_seed = int(cfg.seed % (2**31)) if cfg.seed is not None else 0
    # Pré-résolution allégée : sur ce modèle (~15 000 booléens) la pré-résolution complète peut
    # consommer tout le budget de temps avant que la recherche ne démarre.
    solver.parameters.max_presolve_iterations = int(cfg.params.get("presolve_iterations", 1))
    solver.parameters.cp_model_probing_level = int(cfg.params.get("probing_level", 0))

    class _CB(cp_model.CpSolverSolutionCallback):
        def __init__(self) -> None:
            super().__init__()
            self.count = 0

        def on_solution_callback(self) -> None:
            self.count += 1
            tr.history.append({"iteration": self.count, "elapsed_s": round(tr.elapsed, 4),
                               "current": self.objective_value, "best": self.objective_value})
            if tr.cancel is not None and tr.cancel.is_set():
                self.stop_search()

    cb = _CB()
    status = solver.solve(m, cb)
    if tr.cancel is not None and tr.cancel.is_set():
        raise OptimizationCancelled()
    status_name = solver.status_name(status)
    if status == cp_model.INFEASIBLE:
        raise InfeasibleConstraints("CP-SAT : contraintes infaisables (recouvrement ou équilibre trop strict).")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        st = build_state(hint, cfg.weights, cfg.max_common, track_overlap=True)
        notes = [f"Statut CP-SAT : {status_name} — aucune solution trouvée dans le temps imparti. "
                 "La solution initiale (recuit simulé) est renvoyée ; augmentez le temps maximal."]
        return st, cb.count, notes, "fallback"
    grids = []
    for g in range(n):
        nums = tuple(v for v in numbers if solver.value(x[g, v]))
        sts = tuple(s for s in stars if solver.value(y[g, s]))
        grids.append(sampler.features(nums, sts))
    st = build_state(grids, cfg.weights, cfg.max_common, track_overlap=True)
    notes = [
        f"Statut CP-SAT : {status_name} ; borne supérieure de l'objectif CP : {solver.best_objective_bound:.0f}, "
        f"valeur atteinte : {solver.objective_value:.0f}.",
        "Le modèle CP-SAT optimise la couverture des paires de numéros et d'étoiles sous contraintes d'équilibre "
        f"et de recouvrement (≤ {mc} numéros communs) ; les triplets et l'indice de motif sont évalués a posteriori.",
    ]
    if tr.history:
        final_obj = st.objective()
        last = tr.history[-1]["best"] or 1
        for h in tr.history:
            h["current"] = h["best"] = final_obj * (h["best"] / last) if last else final_obj
    return st, cb.count, notes, status_name


def _first_number_expr(m, x, g, numbers, hint_value: int):
    """Variable entière égale au plus petit numéro de la grille g."""
    f = m.new_int_var(1, 50, "")
    m.add_hint(f, hint_value)
    for v in numbers:
        m.add(f <= v).only_enforce_if(x[g, v])
    sel = []
    for v in numbers:
        b = m.new_bool_var("")
        m.add_hint(b, v == hint_value)
        m.add(f == v).only_enforce_if(b)
        m.add_implication(b, x[g, v])
        sel.append(b)
    m.add_exactly_one(sel)
    return f


def optimize(cfg: OptimizerConfig, progress: ProgressFn | None = None, cancel: Event | None = None,
             past_draws: frozenset | None = None) -> OptimizerResult:
    if cfg.method not in METHODS:
        raise ValueError(f"Méthode inconnue : {cfg.method}")
    if not 1 <= cfg.n_grids <= 10_000:
        raise ValueError("Le nombre de grilles doit être compris entre 1 et 10 000.")
    if cfg.time_limit_s <= 0:
        raise ValueError("Le temps maximal doit être positif.")
    seed = cfg.seed if cfg.seed is not None else new_seed()
    cfg.seed = seed
    rng = random.Random(seed)
    sampler = Sampler(rng, cfg.constraints, past_draws)
    tr = _Tracker(cfg, progress, cancel)
    notes: list[str] = []
    status = "ok"
    if cfg.method == "greedy":
        st, it = _greedy(cfg, sampler, tr)
    elif cfg.method == "local_search":
        st, it = _local_search(cfg, sampler, tr)
    elif cfg.method == "simulated_annealing":
        st, it = _annealing(cfg, sampler, tr)
    elif cfg.method == "tabu":
        st, it = _tabu(cfg, sampler, tr)
    elif cfg.method == "genetic":
        st, it = _genetic(cfg, sampler, tr)
    else:
        st, it, notes, status = _cp_sat(cfg, sampler, tr)
    obj = st.objective()
    tr.tick(it, obj, max(obj, tr.history[-1]["best"] if tr.history else obj), force=True)
    grids = sorted((g.numbers, g.stars) for g in st.grids)
    metrics = portfolio_metrics(grids, cfg.weights, cfg.max_common, include_matrix=True)
    params = {
        "n_grids": cfg.n_grids,
        "weights": cfg.weights.as_dict(),
        "constraints": cfg.constraints.as_dict(),
        "max_common": cfg.max_common,
        "time_limit_s": cfg.time_limit_s,
        "max_iterations": cfg.max_iterations,
        **cfg.params,
    }
    return OptimizerResult(
        method=cfg.method, grids=grids, objective=obj, metrics=metrics, iterations=it,
        elapsed_s=tr.elapsed, seed=seed, params=params, history=tr.history, status=status, notes=notes,
    )


def compare_methods(base: OptimizerConfig, methods: list[str], progress: ProgressFn | None = None,
                    cancel: Event | None = None, past_draws: frozenset | None = None) -> dict[str, Any]:
    """Compare plusieurs méthodes avec la même graine, la même fonction objectif et le même budget de temps."""
    seed = base.seed if base.seed is not None else new_seed()
    results = []
    for k, method in enumerate(methods):
        cfg = OptimizerConfig(
            n_grids=base.n_grids, method=method, weights=base.weights, constraints=base.constraints,
            max_common=base.max_common, time_limit_s=base.time_limit_s, max_iterations=base.max_iterations,
            seed=seed, params=dict(base.params),
        )

        def sub_progress(f: float, msg: str, k: int = k) -> None:
            if progress:
                progress((k + f) / len(methods), msg)

        try:
            results.append(optimize(cfg, sub_progress, cancel, past_draws).as_dict())
        except OptimizationCancelled:
            raise
        except (ValueError, InfeasibleConstraints) as exc:
            results.append({"method": method, "method_label": METHODS[method], "status": "error", "error": str(exc)})
    ok = [r for r in results if r.get("status") != "error"]
    best = max(ok, key=lambda r: r["objective"])["method"] if ok else None
    return {
        "seed": seed,
        "results": results,
        "best_method_for_objective": best,
        "note": (
            "Comparaison à graine, objectif et budget de temps identiques. La « meilleure » méthode l'est "
            "uniquement pour cette fonction objectif de diversification/couverture, pas pour les chances de gain."
        ),
    }
