"""Exports CSV, Excel, JSON et PDF."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Sequence

FORMATS = {"csv", "xlsx", "json", "pdf"}
MEDIA_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "json": "application/json",
    "pdf": "application/pdf",
}

METHOD_LIMITS = [
    "Chaque grille valide a exactement la même probabilité de gagner le jackpot : 1 sur 139 838 160.",
    "Les scores de diversité, de couverture et de motif décrivent la structure du portefeuille ; ce ne sont pas "
    "des probabilités de sortie.",
    "Les statistiques historiques sont descriptives et n'ont aucune valeur prédictive démontrée.",
    "Les montants de gains ne sont affichés que lorsqu'ils proviennent d'une source importée ou d'une hypothèse saisie.",
    "Jouer comporte un risque de perte ; ce n'est pas un investissement.",
]


def _safe_cell(v: Any) -> Any:
    """Neutralise les injections de formules dans les tableurs (=, +, -, @ en début de cellule)."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def to_csv(rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(columns)
    for r in rows:
        w.writerow([_safe_cell(_flat(r.get(c))) for c in columns])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _flat(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        return " ".join(str(x) for x in v)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return v


def to_xlsx(sheets: dict[str, tuple[Sequence[str], Sequence[dict[str, Any]]]], meta: dict[str, Any] | None = None) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    first = True
    for name, (columns, rows) in sheets.items():
        ws = wb.active if first else wb.create_sheet()
        first = False
        ws.title = name[:31]
        ws.append(list(columns))
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1E1B4B")
        for r in rows:
            ws.append([_safe_cell(_flat(r.get(c))) for c in columns])
        for i, col in enumerate(columns, start=1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = max(10, min(40, len(str(col)) + 4))
    if meta:
        ws = wb.create_sheet("Informations")
        for k, v in meta.items():
            ws.append([str(k), _safe_cell(_flat(v))])
        ws.append([])
        for line in METHOD_LIMITS:
            ws.append(["Limite", line])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def to_json(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def to_pdf(title: str, sections: list[dict[str, Any]], params: dict[str, Any] | None = None) -> bytes:
    """Rapport PDF : date, paramètres, sections (texte, tableaux, grilles), hypothèses et limites."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.5 * cm, title=title,
                            author="EuroMillions Quantum Analytics")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=colors.HexColor("#1E1B4B"), fontSize=18)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#5B21B6"))
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor=colors.HexColor("#444444"))

    def esc(s: Any) -> str:
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    story: list[Any] = [Paragraph(esc(title), h1),
                        Paragraph(f"Généré le {datetime.now(timezone.utc).strftime('%d/%m/%Y à %H:%M UTC')} — "
                                  "EuroMillions Quantum Analytics", small), Spacer(1, 10)]
    if params:
        story.append(Paragraph("Paramètres utilisés", h2))
        story.append(_table([[esc(k), esc(_flat(v))] for k, v in params.items()], [5 * cm, 12 * cm], header=False))
    for sec in sections:
        story.append(Paragraph(esc(sec["title"]), h2))
        for p in sec.get("paragraphs", []):
            story.append(Paragraph(esc(p), body))
        if sec.get("table"):
            cols, rows = sec["table"]
            data = [[esc(c) for c in cols]] + [[esc(_flat(r.get(c))) for c in cols] for r in rows[:2000]]
            story.append(_table(data, None, header=True))
            if len(rows) > 2000:
                story.append(Paragraph(f"… {len(rows) - 2000} lignes supplémentaires (voir export CSV/Excel).", small))
        story.append(Spacer(1, 6))
    story.append(Paragraph("Hypothèses et limites méthodologiques", h2))
    for line in METHOD_LIMITS:
        story.append(Paragraph("• " + esc(line), body))

    def _footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#666666"))
        canvas.drawString(1.6 * cm, 1 * cm, "Analyse statistique — aucune garantie de gain. Jouer comporte des risques.")
        canvas.drawRightString(A4[0] - 1.6 * cm, 1 * cm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def _table(data: list[list[str]], widths: list[float] | None, header: bool) -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBCC")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor("#F4F2FB")]),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E1B4B")),
                  ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
    t.setStyle(TableStyle(style))
    return t


# ---------------------------------------------------------------------------
# Exports métier
# ---------------------------------------------------------------------------

GRID_COLUMNS = ["id", "n1", "n2", "n3", "n4", "n5", "e1", "e2", "strategie", "score_diversite", "indice_motif", "date"]


def grid_rows(grids: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for i, g in enumerate(grids, start=1):
        n, s = g["numbers"], g["stars"]
        rows.append({
            "id": g.get("id", i), "n1": n[0], "n2": n[1], "n3": n[2], "n4": n[3], "n5": n[4], "e1": s[0], "e2": s[1],
            "strategie": g.get("strategy", ""), "score_diversite": g.get("diversity_score"),
            "indice_motif": g.get("pattern_score"), "date": g.get("generated_at") or g.get("created_at") or "",
        })
    return rows


def export_portfolio(fmt: str, name: str, grids: Sequence[dict[str, Any]], metrics: dict[str, Any] | None,
                     params: dict[str, Any] | None) -> bytes:
    rows = grid_rows(grids)
    metrics = metrics or {}
    summary = {
        "Nombre de grilles": len(rows),
        "Coût total (€)": metrics.get("cost"),
        "Probabilité de jackpot": (metrics.get("probabilities") or {}).get("jackpot", {}).get("one_in"),
        "Diversité": _r(metrics.get("diversity")),
        "Couverture des paires": _r(metrics.get("pair_coverage")),
        "Couverture des triplets": _r(metrics.get("triple_coverage")),
        "Répartition des étoiles": _r(metrics.get("star_score")),
        "Doublons": metrics.get("duplicates"),
    }
    if fmt == "csv":
        return to_csv(rows, GRID_COLUMNS)
    if fmt == "json":
        return to_json({"name": name, "params": params, "metrics": metrics, "grids": grids, "limits": METHOD_LIMITS})
    if fmt == "xlsx":
        return to_xlsx({"Grilles": (GRID_COLUMNS, rows)}, {"Portefeuille": name, **summary, **(params or {})})
    if fmt == "pdf":
        sections = [
            {"title": "Statistiques principales", "table": (["Indicateur", "Valeur"],
                                                             [{"Indicateur": k, "Valeur": v} for k, v in summary.items()])},
            {"title": "Grilles sélectionnées", "table": (GRID_COLUMNS[:9], rows)},
        ]
        probs = (metrics.get("probabilities") or {}).get("expected_wins_by_rank")
        if probs:
            sections.append({"title": "Probabilités théoriques par rang (par grille) et gains espérés du portefeuille",
                             "table": (["rang", "combinaison", "probabilité", "gains espérés"],
                                       [{"rang": p["rank"], "combinaison": p["label"],
                                         "probabilité": p["single_grid_probability"]["one_in"],
                                         "gains espérés": round(p["expected_wins"], 4)} for p in probs])})
        return to_pdf(f"Portefeuille — {name}", sections, params)
    raise ValueError(f"Format non supporté : {fmt}")


def _r(v: Any) -> Any:
    return round(v, 4) if isinstance(v, float) else v


def export_rows(fmt: str, title: str, columns: Sequence[str], rows: Sequence[dict[str, Any]],
                payload: Any = None, params: dict[str, Any] | None = None,
                paragraphs: list[str] | None = None) -> bytes:
    if fmt == "csv":
        return to_csv(rows, columns)
    if fmt == "json":
        return to_json(payload if payload is not None else {"title": title, "rows": list(rows)})
    if fmt == "xlsx":
        return to_xlsx({title[:31]: (columns, rows)}, params or {})
    if fmt == "pdf":
        return to_pdf(title, [{"title": title, "paragraphs": paragraphs or [], "table": (list(columns), list(rows))}], params)
    raise ValueError(f"Format non supporté : {fmt}")
