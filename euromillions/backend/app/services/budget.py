"""Gestion du budget : coûts, grilles finançables et probabilités sur la durée.

Avertissement : jouer à l'EuroMillions a une espérance de gain négative.
Acheter davantage de grilles augmente la dépense plus vite que les chances
ne deviennent significatives : ce n'est jamais une stratégie d'investissement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from app.core.probability import (
    any_prize_probability,
    portfolio_jackpot_probability,
    probability_payload,
    repeated_draws_probability_float,
    total_combinations,
)

RISK_WARNING = (
    "Les jeux d'argent comportent un risque de perte : en moyenne, les joueurs perdent une part importante de leurs "
    "mises. Ne jouez que des sommes que vous pouvez vous permettre de perdre. Acheter plus de grilles n'est pas un "
    "investissement. Besoin d'aide : Joueurs Info Service, 09 74 75 13 13 (appel non surtaxé)."
)


@dataclass
class BudgetInput:
    ticket_price: float = 2.5
    draws_per_week: int = 2
    n_grids: int | None = None
    budget_per_draw: float | None = None
    budget_weekly: float | None = None
    budget_monthly: float | None = None
    duration_weeks: int = 52
    assumed_return_rate: float | None = None  # part moyenne des mises redistribuée (hypothèse)
    exact_p_any_win: float | None = None  # issu de l'analyse exacte d'un portefeuille


def _grids_from_budget(b: BudgetInput) -> tuple[int, str]:
    if b.n_grids is not None:
        return b.n_grids, "nombre de grilles saisi"
    if b.budget_per_draw is not None:
        return int(math.floor(b.budget_per_draw / b.ticket_price + 1e-9)), "budget par tirage"
    if b.budget_weekly is not None:
        return int(math.floor(b.budget_weekly / b.draws_per_week / b.ticket_price + 1e-9)), "budget hebdomadaire"
    if b.budget_monthly is not None:
        weekly = b.budget_monthly * 12 / 52
        return int(math.floor(weekly / b.draws_per_week / b.ticket_price + 1e-9)), "budget mensuel (×12/52 par semaine)"
    raise ValueError("Indiquez un nombre de grilles ou un budget (par tirage, hebdomadaire ou mensuel).")


def budget_analysis(b: BudgetInput) -> dict[str, Any]:
    if b.ticket_price <= 0:
        raise ValueError("Le prix d'une grille doit être positif.")
    if b.draws_per_week not in (1, 2):
        raise ValueError("Le nombre de tirages par semaine doit être 1 ou 2.")
    if not 1 <= b.duration_weeks <= 52 * 80:
        raise ValueError("La durée doit être comprise entre 1 et 4 160 semaines.")
    n, basis = _grids_from_budget(b)
    if n < 0:
        raise ValueError("Budget négatif.")
    total = total_combinations()
    n = min(n, total)
    draws = b.duration_weeks * b.draws_per_week
    cost_draw = n * b.ticket_price
    p_jp = portfolio_jackpot_probability(n)
    p_jp_horizon = repeated_draws_probability_float(float(p_jp), draws)
    p_single_any = float(any_prize_probability())
    secondary: dict[str, Any] = {
        "expected_wins_per_draw": p_single_any * n,
        "expected_wins_horizon": p_single_any * n * draws,
    }
    if b.exact_p_any_win is not None:
        secondary["p_any_win_per_draw"] = b.exact_p_any_win
        secondary["p_any_win_horizon"] = repeated_draws_probability_float(b.exact_p_any_win, draws)
        secondary["method"] = "Analyse exacte du portefeuille enregistré."
    elif n > 0:
        lo, hi = p_single_any, min(1.0, p_single_any * n)
        secondary["p_any_win_per_draw_bounds"] = [lo, hi]
        secondary["p_any_win_horizon_bounds"] = [
            repeated_draws_probability_float(lo, draws), repeated_draws_probability_float(hi, draws)
        ]
        secondary["method"] = (
            "Sans portefeuille précis, seule une fourchette est exacte : au moins la probabilité d'une grille seule "
            "(≈ 1/13), au plus N fois celle-ci (borne de l'union). La valeur réelle dépend des recouvrements entre "
            "grilles : choisissez un portefeuille enregistré pour un calcul exact."
        )
    per_year = b.draws_per_week * 52
    out: dict[str, Any] = {
        "n_grids": n,
        "n_grids_basis": basis,
        "ticket_price": b.ticket_price,
        "cost_per_draw": round(cost_draw, 2),
        "draws": draws,
        "total_cost": round(cost_draw * draws, 2),
        "annual_cost": round(cost_draw * per_year, 2),
        "monthly_cost": round(cost_draw * per_year / 12, 2),
        "p_jackpot_per_draw": probability_payload(p_jp),
        "p_jackpot_horizon": p_jp_horizon,
        "years_for_50pct_jackpot": _years_for(0.5, float(p_jp), per_year),
        "secondary": secondary,
        "scenarios": scenarios(b.ticket_price, b.draws_per_week, b.duration_weeks),
        "curve": cost_probability_curve(b.ticket_price, b.draws_per_week, b.duration_weeks),
        "hypotheses": [
            "Tirages équitables et indépendants ; règles actuelles (5/50 et 2/12) inchangées sur la durée.",
            "Grilles distinctes au sein d'un même tirage ; même nombre de grilles à chaque tirage.",
            f"Prix unitaire : {b.ticket_price:.2f} € (paramètre modifiable).",
        ],
        "warning": RISK_WARNING,
    }
    if b.assumed_return_rate is not None:
        if not 0 <= b.assumed_return_rate <= 1:
            raise ValueError("Le taux de retour supposé doit être compris entre 0 et 1.")
        out["expected_loss"] = round(cost_draw * draws * (1 - b.assumed_return_rate), 2)
        out["assumed_return_rate"] = b.assumed_return_rate
        out["hypotheses"].append(
            f"Taux de retour moyen supposé : {b.assumed_return_rate:.0%} des mises (hypothèse saisie ; la part des "
            "mises affectée aux gains est fixée par le règlement du jeu en vigueur)."
        )
    return out


def _years_for(target: float, p: float, per_year: int) -> float | None:
    if p <= 0:
        return None
    draws = math.log(1 - target) / math.log1p(-p) if p < 1 else 1
    return draws / per_year


def scenarios(price: float, draws_per_week: int, weeks: int) -> list[dict[str, Any]]:
    out = []
    draws = weeks * draws_per_week
    for n in (1, 2, 5, 10, 20, 50, 100, 500, 1000):
        p = Fraction(n, total_combinations())
        out.append({
            "n_grids": n,
            "cost_per_draw": round(n * price, 2),
            "total_cost": round(n * price * draws, 2),
            "annual_cost": round(n * price * draws_per_week * 52, 2),
            "p_jackpot_horizon": repeated_draws_probability_float(float(p), draws),
            "one_in_horizon": (1 / repeated_draws_probability_float(float(p), draws)),
            "years_for_50pct": _years_for(0.5, float(p), draws_per_week * 52),
        })
    return out


def cost_probability_curve(price: float, draws_per_week: int, weeks: int, points: int = 40) -> list[dict[str, float]]:
    draws = weeks * draws_per_week
    out = []
    for k in range(points):
        n = max(1, int(round(10 ** (k * 4 / (points - 1)))))  # 1 à 10 000 grilles (échelle log)
        p = n / total_combinations()
        out.append({"n_grids": n, "total_cost": round(n * price * draws, 2),
                    "p_jackpot_horizon": repeated_draws_probability_float(p, draws)})
    uniq = {}
    for pt in out:
        uniq[pt["n_grids"]] = pt
    return list(uniq.values())
