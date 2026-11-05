"""Analyse d'un jackpot (par défaut 130 M€) : espérance de gain sous hypothèses explicites.

On distingue :
1. l'espérance liée au jackpot (avec partage éventuel entre gagnants) ;
2. l'espérance liée aux autres rangs (selon des gains supposés, saisis ou
   observés dans l'historique importé) ;
3. l'espérance nette après mises.

Modèle de partage : le nombre K d'autres gagnants du jackpot suit une loi de
Poisson de paramètre λ = (grilles jouées par les autres) × p × m, où m est un
multiplicateur de popularité de votre combinaison (1 = combinaison « moyenne »).
Si vous gagnez, votre part vaut J / (1 + K), d'où E[part] = J (1 − e^{−λ}) / λ.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any

from app.core.probability import match_probability, portfolio_jackpot_probability, probability_payload, total_combinations
from app.core.rules import CURRENT_TIERS


@dataclass
class JackpotInput:
    jackpot: float = 130_000_000.0
    n_grids: int = 1
    ticket_price: float = 2.5
    other_tickets: float | None = None  # grilles jouées par les autres participants (estimation)
    expected_other_winners: float | None = None  # λ fourni directement
    popularity_multiplier: float = 1.0
    secondary_payouts: dict[int, float] = field(default_factory=dict)
    payouts_source: str = "saisie utilisateur"


def share_factor(lam: float) -> float:
    """E[1/(1+K)] pour K ~ Poisson(λ)."""
    if lam < 0:
        raise ValueError("λ doit être positif.")
    if lam < 1e-12:
        return 1.0
    return -math.expm1(-lam) / lam


def jackpot_analysis(j: JackpotInput) -> dict[str, Any]:
    if j.jackpot <= 0:
        raise ValueError("Le montant du jackpot doit être positif.")
    if not 1 <= j.n_grids <= 10_000_000:
        raise ValueError("Nombre de grilles invalide.")
    if j.ticket_price <= 0:
        raise ValueError("Le prix d'une grille doit être positif.")
    if j.popularity_multiplier <= 0:
        raise ValueError("Le multiplicateur de popularité doit être positif.")
    p1 = float(Fraction(1, total_combinations()))
    if j.expected_other_winners is not None:
        lam = j.expected_other_winners * j.popularity_multiplier
        lam_basis = "λ saisi directement"
    elif j.other_tickets is not None:
        lam = j.other_tickets * p1 * j.popularity_multiplier
        lam_basis = f"λ = {j.other_tickets:,.0f} grilles × 1/139 838 160 × {j.popularity_multiplier:g}".replace(",", " ")
    else:
        lam = 0.0
        lam_basis = "aucun autre gagnant supposé (λ = 0) — hypothèse optimiste"
    sf = share_factor(lam)
    p_jp = portfolio_jackpot_probability(j.n_grids)
    cost = j.n_grids * j.ticket_price
    ev_jackpot = float(p_jp) * j.jackpot * sf
    sec_rows = []
    ev_secondary = 0.0
    for t in CURRENT_TIERS:
        if t.rank == 1:
            continue
        amount = j.secondary_payouts.get(t.rank)
        p = float(match_probability(t.numbers, t.stars))
        contrib = p * j.n_grids * amount if amount is not None else None
        if contrib:
            ev_secondary += contrib
        sec_rows.append({"rank": t.rank, "label": t.label, "assumed_payout": amount, "probability": p,
                         "expected_value": contrib})
    ev_total = ev_jackpot + ev_secondary
    ev_net = ev_total - cost
    p_win = float(p_jp)
    break_even = None
    if p_win > 0 and sf > 0:
        needed = cost - ev_secondary
        break_even = needed / (p_win * sf) if needed > 0 else 0.0
    sensitivity = []
    for lam_s in (0.0, 0.25, 0.5, 1.0, 2.0, 3.0):
        row = {"lambda": lam_s, "share_factor": share_factor(lam_s), "values": []}
        for jp in (17e6, 50e6, 100e6, 130e6, 200e6, 250e6):
            evj = float(p_jp) * jp * share_factor(lam_s)
            row["values"].append({"jackpot": jp, "ev_net": evj + ev_secondary - cost,
                                  "return_per_euro": (evj + ev_secondary) / cost})
        sensitivity.append(row)
    return {
        "inputs": {
            "jackpot": j.jackpot, "n_grids": j.n_grids, "ticket_price": j.ticket_price,
            "other_tickets": j.other_tickets, "expected_other_winners": j.expected_other_winners,
            "popularity_multiplier": j.popularity_multiplier, "payouts_source": j.payouts_source,
        },
        "p_jackpot": probability_payload(p_jp),
        "gross_if_sole_winner": j.jackpot,
        "lambda": lam,
        "lambda_basis": lam_basis,
        "p_no_other_winner": math.exp(-lam),
        "expected_share_if_win": j.jackpot * sf,
        "share_factor": sf,
        "cost": round(cost, 2),
        "ev_jackpot": ev_jackpot,
        "ev_secondary": ev_secondary,
        "ev_total": ev_total,
        "ev_net": ev_net,
        "return_per_euro": ev_total / cost,
        "break_even_jackpot": break_even,
        "secondary": sec_rows,
        "sensitivity": sensitivity,
        "hypotheses": [
            "Tirage équitable : P(jackpot) = N / 139 838 160 pour N grilles distinctes.",
            "Le montant annoncé n'est pas un gain garanti : il est partagé entre tous les gagnants du rang 1.",
            "Partage modélisé par une loi de Poisson (choix des autres joueurs supposés indépendants).",
            "Sans données fiables sur la popularité des combinaisons, le multiplicateur vaut 1 par défaut.",
            "Les gains des rangs 2 à 13 sont des hypothèses (" + j.payouts_source + ") : les rapports réels "
            "varient à chaque tirage. Un rang sans gain saisi est compté pour 0.",
            "Fiscalité et options annexes (My Million…) non prises en compte.",
        ],
        "warning": (
            "Même avec un jackpot élevé, l'espérance nette reste généralement négative et la probabilité de gagner "
            "le jackpot reste infime. Jouer n'est pas un investissement."
        ),
    }
