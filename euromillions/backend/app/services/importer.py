"""Import et validation des tirages historiques (CSV, Excel, ZIP, URL autorisée).

Principes :
* aucune donnée n'est inventée : une ligne invalide est rejetée avec un motif ;
* les colonnes sont reconnues par alias (format FDJ et formats génériques) ;
* les étoiles sont validées selon l'époque de règles correspondant à la date ;
* les doublons (même date) sont détectés dans le fichier et en base.
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.grid import GridValidationError, validate_grid
from app.core.rules import Era, era_for_date
from app.models import DataSource, Draw, DrawPrize, utcnow


class ImportErrorFatal(ValueError):
    """Erreur bloquante (fichier illisible, colonnes manquantes, source refusée…)."""


@dataclass
class ParsedDraw:
    line: int
    draw_date: date
    numbers: tuple[int, ...]
    stars: tuple[int, ...]
    era: Era
    jackpot: float | None = None
    prizes: dict[int, tuple[int | None, float | None]] = field(default_factory=dict)

    def same_values(self, other: "ParsedDraw | Draw") -> bool:
        return tuple(other.numbers) == self.numbers and tuple(other.stars) == self.stars


@dataclass
class ImportIssue:
    line: int
    level: str  # error | warning
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {"line": self.line, "level": self.level, "message": self.message}


@dataclass
class ParseReport:
    total_rows: int = 0
    draws: list[ParsedDraw] = field(default_factory=list)
    issues: list[ImportIssue] = field(default_factory=list)
    duplicates_in_file: int = 0
    columns_detected: dict[str, Any] = field(default_factory=dict)

    @property
    def errors(self) -> list[ImportIssue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[ImportIssue]:
        return [i for i in self.issues if i.level == "warning"]


# ---------------------------------------------------------------------------
# Lecture des fichiers
# ---------------------------------------------------------------------------

DEMO_MARKER = "DEMO-FICTIF"
ALLOWED_EXTENSIONS = {".csv", ".txt", ".xlsx", ".xlsm", ".zip"}
ZIP_MAX_MEMBERS = 50
ZIP_MAX_UNCOMPRESSED = 60 * 1024 * 1024


def _ext(filename: str) -> str:
    m = re.search(r"(\.[A-Za-z0-9]+)$", filename or "")
    return m.group(1).lower() if m else ""


def _decode(content: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ImportErrorFatal("Encodage du fichier non reconnu.")


def _read_csv_bytes(content: bytes) -> pd.DataFrame:
    text = _decode(content)
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        raise ImportErrorFatal("Le fichier est vide.")
    header = lines[0]
    delim = max([";", ",", "\t", "|"], key=header.count)
    if header.count(delim) == 0:
        raise ImportErrorFatal("Impossible de détecter le séparateur de colonnes.")
    try:
        df = pd.read_csv(
            io.StringIO("\n".join(lines)), sep=delim, dtype=str, keep_default_na=False, skipinitialspace=True
        )
    except Exception as exc:  # pandas lève plusieurs types d'erreurs de parsing
        raise ImportErrorFatal(f"Fichier CSV illisible : {exc}") from exc
    return df


def _read_excel_bytes(content: bytes) -> pd.DataFrame:
    try:
        df = pd.read_excel(io.BytesIO(content), dtype=object, engine="openpyxl")
    except Exception as exc:
        raise ImportErrorFatal(f"Fichier Excel illisible : {exc}") from exc
    return df


def _read_zip_bytes(content: bytes) -> pd.DataFrame:
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise ImportErrorFatal("Archive ZIP invalide.") from exc
    members = [m for m in zf.infolist() if not m.is_dir()]
    if len(members) > ZIP_MAX_MEMBERS:
        raise ImportErrorFatal("Archive ZIP : trop de fichiers.")
    if sum(m.file_size for m in members) > ZIP_MAX_UNCOMPRESSED:
        raise ImportErrorFatal("Archive ZIP : taille décompressée excessive.")
    frames = []
    for m in members:
        name = m.filename.rsplit("/", 1)[-1]
        if name.startswith(".") or _ext(name) not in {".csv", ".txt", ".xlsx"}:
            continue
        data = zf.read(m)
        frames.append(_read_excel_bytes(data) if _ext(name) == ".xlsx" else _read_csv_bytes(data))
    if not frames:
        raise ImportErrorFatal("Aucun fichier CSV ou Excel dans l'archive.")
    return pd.concat(frames, ignore_index=True, sort=False)


def read_table(content: bytes, filename: str) -> pd.DataFrame:
    settings = get_settings()
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise ImportErrorFatal(f"Fichier trop volumineux (limite : {settings.max_upload_mb:g} Mo).")
    ext = _ext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise ImportErrorFatal(f"Extension non autorisée ({ext or 'aucune'}). Formats acceptés : CSV, Excel, ZIP.")
    if ext in {".xlsx", ".xlsm"}:
        if not content.startswith(b"PK"):
            raise ImportErrorFatal("Le contenu ne correspond pas à un fichier Excel.")
        df = _read_excel_bytes(content)
    elif ext == ".zip":
        df = _read_zip_bytes(content)
    else:
        if b"\x00" in content[:4096]:
            raise ImportErrorFatal("Le fichier semble binaire, pas un CSV.")
        df = _read_csv_bytes(content)
    if len(df) > settings.max_import_rows:
        raise ImportErrorFatal(f"Trop de lignes ({len(df)}) ; limite : {settings.max_import_rows}.")
    return df


# ---------------------------------------------------------------------------
# Reconnaissance des colonnes
# ---------------------------------------------------------------------------


def normalize_column(name: Any) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


DATE_ALIASES = ["date_de_tirage", "date_tirage", "draw_date", "date", "date_du_tirage"]
NUMBER_PATTERNS = [r"boule_?{i}", r"numero_?{i}", r"num_?{i}", r"n_?{i}", r"ball_?{i}", r"b_?{i}", r"number_?{i}"]
STAR_PATTERNS = [r"etoile_?{i}", r"star_?{i}", r"lucky_star_?{i}", r"e_?{i}", r"s_?{i}"]
JACKPOT_ALIASES = ["jackpot", "jackpot_eur", "jackpot_annonce", "montant_jackpot"]
WINNERS_RE = re.compile(r"^(?:nombre_de_gagnants?_au_rang|winners_rank|gagnants_rang)_?(\d{1,2})(?:_(.*))?$")
PRIZE_RE = re.compile(r"^(?:rapport_du_rang|prize_rank|gain_rang)_?(\d{1,2})(?:_(.*))?$")


def detect_columns(columns: list[str]) -> dict[str, Any]:
    norm = {normalize_column(c): c for c in columns}
    found: dict[str, Any] = {"numbers": [], "stars": [], "winners": {}, "prizes": {}}
    found["date"] = next((norm[a] for a in DATE_ALIASES if a in norm), None)
    for i in range(1, 6):
        col = None
        for pat in NUMBER_PATTERNS:
            rx = re.compile("^" + pat.format(i=i) + "$")
            col = next((orig for n, orig in norm.items() if rx.match(n)), None)
            if col:
                break
        found["numbers"].append(col)
    for i in range(1, 3):
        col = None
        for pat in STAR_PATTERNS:
            rx = re.compile("^" + pat.format(i=i) + "$")
            col = next((orig for n, orig in norm.items() if rx.match(n)), None)
            if col:
                break
        found["stars"].append(col)
    found["jackpot"] = next((norm[a] for a in JACKPOT_ALIASES if a in norm), None)
    for n, orig in norm.items():
        m = WINNERS_RE.match(n)
        if m:
            rank, suffix = int(m.group(1)), m.group(2) or ""
            if 1 <= rank <= 13 and ("france" not in suffix):
                # Priorité au total « en Europe » (format FDJ) ou à une colonne sans suffixe.
                if rank not in found["winners"] or "europe" in suffix:
                    found["winners"][rank] = orig
        m = PRIZE_RE.match(n)
        if m:
            rank = int(m.group(1))
            if 1 <= rank <= 13 and rank not in found["prizes"]:
                found["prizes"][rank] = orig
    missing = []
    if found["date"] is None:
        missing.append("date")
    missing += [f"numéro {i + 1}" for i, c in enumerate(found["numbers"]) if c is None]
    missing += [f"étoile {i + 1}" for i, c in enumerate(found["stars"]) if c is None]
    if missing:
        raise ImportErrorFatal(
            "Colonnes obligatoires introuvables : " + ", ".join(missing) + ". "
            "Colonnes attendues par exemple : date, n1…n5, e1, e2 (ou format FDJ : date_de_tirage, boule_1…, etoile_1…)."
        )
    return found


# ---------------------------------------------------------------------------
# Conversion et validation des valeurs
# ---------------------------------------------------------------------------

DATE_FORMATS = ("%d/%m/%Y", "%Y-%m-%d", "%Y%m%d", "%d/%m/%y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y")


def parse_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, pd.Timestamp):
        return value.date()
    s = str(value).strip()
    if not s:
        raise ValueError("date manquante")
    s = s.split(" ")[0].split("T")[0]
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"date illisible « {value} »")


def parse_int(value: Any, what: str) -> int:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        raise ValueError(f"{what} manquant")
    if isinstance(value, bool):
        raise ValueError(f"{what} invalide")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        raise ValueError(f"{what} non entier ({value})")
    s = str(value).strip().replace(" ", "")
    if not s:
        raise ValueError(f"{what} manquant")
    if re.fullmatch(r"[+-]?\d+", s):
        return int(s)
    if re.fullmatch(r"[+-]?\d+[.,]0+", s):
        return int(re.split(r"[.,]", s)[0])
    raise ValueError(f"{what} non numérique (« {value} »)")


def parse_amount(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    s = str(value).strip().replace(" ", "").replace(" ", "").replace("€", "")
    if not s or s.lower() in {"na", "n/a", "-", "nan"}:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v >= 0 else None


def parse_dataframe(df: pd.DataFrame, today: date | None = None) -> ParseReport:
    today = today or date.today()
    report = ParseReport(total_rows=len(df))
    cols = detect_columns(list(df.columns))
    report.columns_detected = {
        "date": str(cols["date"]),
        "numbers": [str(c) for c in cols["numbers"]],
        "stars": [str(c) for c in cols["stars"]],
        "jackpot": str(cols["jackpot"]) if cols["jackpot"] else None,
        "winners_ranks": sorted(cols["winners"].keys()),
        "prize_ranks": sorted(cols["prizes"].keys()),
    }
    seen: dict[date, ParsedDraw] = {}
    for pos, row in enumerate(df.to_dict(orient="records")):
        line = pos + 2  # ligne 1 = en-tête
        if all((v is None or str(v).strip() == "" or (isinstance(v, float) and pd.isna(v))) for v in row.values()):
            continue
        try:
            d = parse_date(row[cols["date"]])
        except ValueError as exc:
            report.issues.append(ImportIssue(line, "error", f"Date invalide : {exc}."))
            continue
        if d > today:
            report.issues.append(ImportIssue(line, "error", f"Date {d.isoformat()} dans le futur."))
            continue
        try:
            era = era_for_date(d)
        except ValueError as exc:
            report.issues.append(ImportIssue(line, "error", str(exc)))
            continue
        try:
            numbers = [parse_int(row[c], "numéro") for c in cols["numbers"]]
            stars = [parse_int(row[c], "étoile") for c in cols["stars"]]
            validate_grid(numbers, stars, era)
        except (ValueError, GridValidationError) as exc:
            report.issues.append(ImportIssue(line, "error", f"{d.isoformat()} : {exc} (règles {era.label})."))
            continue
        if d.weekday() not in era.draw_weekdays:
            jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            report.issues.append(
                ImportIssue(line, "warning", f"{d.isoformat()} est un {jours[d.weekday()]}, jour inhabituel pour cette époque.")
            )
        parsed = ParsedDraw(line, d, tuple(sorted(numbers)), tuple(sorted(stars)), era)
        if cols["jackpot"]:
            parsed.jackpot = parse_amount(row.get(cols["jackpot"]))
        for rank in set(cols["winners"]) | set(cols["prizes"]):
            winners = None
            if rank in cols["winners"]:
                try:
                    winners = parse_int(row.get(cols["winners"][rank]), "gagnants")
                except ValueError:
                    winners = None
            prize = parse_amount(row.get(cols["prizes"][rank])) if rank in cols["prizes"] else None
            if winners is not None or prize is not None:
                parsed.prizes[rank] = (winners, prize)
        if d in seen:
            if seen[d].same_values(parsed):
                report.duplicates_in_file += 1
                report.issues.append(ImportIssue(line, "warning", f"Doublon du {d.isoformat()} ignoré (ligne {seen[d].line})."))
            else:
                report.issues.append(
                    ImportIssue(line, "error", f"Conflit : deux tirages différents pour le {d.isoformat()} (ligne {seen[d].line}).")
                )
            continue
        seen[d] = parsed
        report.draws.append(parsed)
    report.draws.sort(key=lambda p: p.draw_date)
    return report


# ---------------------------------------------------------------------------
# Écriture en base
# ---------------------------------------------------------------------------


def store_draws(
    db: Session,
    report: ParseReport,
    *,
    source_name: str,
    kind: str,
    location: str | None = None,
    content: bytes | None = None,
    is_demo: bool = False,
    overwrite: bool = False,
) -> dict[str, Any]:
    existing = {d.draw_date: d for d in db.scalars(select(Draw)).all()}
    if existing:
        demo_present = db.scalar(select(DataSource.id).where(DataSource.is_demo.is_(True)).limit(1)) is not None
        if demo_present != is_demo:
            raise ImportErrorFatal(
                "Impossible de mélanger des données de démonstration fictives et des données réelles. "
                "Supprimez d'abord l'historique actuel (Historique → Purger)."
            )
    source = DataSource(
        name=source_name[:200],
        kind=kind,
        location=location,
        sha256=hashlib.sha256(content).hexdigest() if content is not None else None,
        is_demo=is_demo,
        imported_at=utcnow(),
    )
    db.add(source)
    db.flush()
    inserted = skipped = conflicts = updated = 0
    issues = list(report.issues)
    for p in report.draws:
        cur = existing.get(p.draw_date)
        if cur is not None:
            if p.same_values(cur):
                skipped += 1
                _merge_prizes(cur, p)
                continue
            if not overwrite:
                conflicts += 1
                issues.append(
                    ImportIssue(p.line, "error", f"Conflit avec le tirage déjà enregistré du {p.draw_date.isoformat()} (non remplacé).")
                )
                continue
            db.delete(cur)
            db.flush()
            updated += 1
        draw = Draw(
            draw_date=p.draw_date,
            era_code=p.era.code,
            n1=p.numbers[0], n2=p.numbers[1], n3=p.numbers[2], n4=p.numbers[3], n5=p.numbers[4],
            s1=p.stars[0], s2=p.stars[1],
            stars_max=p.era.stars_max,
            jackpot_eur=p.jackpot,
            source_id=source.id,
        )
        for rank, (winners, prize) in sorted(p.prizes.items()):
            draw.prizes.append(DrawPrize(rank=rank, winners=winners, prize_eur=prize))
        db.add(draw)
        inserted += 1
    source.rows_inserted = inserted
    source.rows_duplicated = skipped + report.duplicates_in_file
    source.rows_rejected = len(report.errors) + conflicts
    source.notes = f"{len(report.warnings)} avertissement(s)"
    db.commit()
    _set_last_refresh(db)
    return {
        "source_id": source.id,
        "total_rows": report.total_rows,
        "inserted": inserted,
        "replaced": updated,
        "duplicates_skipped": skipped + report.duplicates_in_file,
        "rejected": len(report.errors) + conflicts,
        "issues": [i.as_dict() for i in issues[:500]],
        "issues_truncated": len(issues) > 500,
        "columns_detected": report.columns_detected,
        "is_demo": is_demo,
    }


def _merge_prizes(draw: Draw, parsed: ParsedDraw) -> None:
    """Complète les gains/gagnants manquants d'un tirage existant (sans écraser)."""
    have = {pr.rank for pr in draw.prizes}
    for rank, (winners, prize) in parsed.prizes.items():
        if rank not in have:
            draw.prizes.append(DrawPrize(rank=rank, winners=winners, prize_eur=prize))
    if draw.jackpot_eur is None and parsed.jackpot is not None:
        draw.jackpot_eur = parsed.jackpot


def _set_last_refresh(db: Session) -> None:
    from app.services.settings_store import set_setting

    set_setting(db, "last_refresh", utcnow().isoformat())


def import_bytes(db: Session, content: bytes, filename: str, *, kind: str, location: str | None = None,
                 overwrite: bool = False, is_demo: bool = False, source_name: str | None = None) -> dict[str, Any]:
    df = read_table(content, filename)
    norm_cols = {normalize_column(c): c for c in df.columns}
    if "source" in norm_cols and df[norm_cols["source"]].astype(str).str.contains(DEMO_MARKER).any():
        is_demo = True  # un fichier marqué comme fictif est toujours traité comme tel
    report = parse_dataframe(df)
    if not report.draws and report.errors:
        return {
            "source_id": None,
            "total_rows": report.total_rows,
            "inserted": 0,
            "replaced": 0,
            "duplicates_skipped": report.duplicates_in_file,
            "rejected": len(report.errors),
            "issues": [i.as_dict() for i in report.issues[:500]],
            "issues_truncated": len(report.issues) > 500,
            "columns_detected": report.columns_detected,
            "is_demo": is_demo,
        }
    return store_draws(
        db, report, source_name=source_name or filename, kind=kind, location=location,
        content=content, is_demo=is_demo, overwrite=overwrite,
    )


# ---------------------------------------------------------------------------
# Téléchargement depuis une URL autorisée
# ---------------------------------------------------------------------------


def check_url_allowed(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ImportErrorFatal("Seules les URL https sont acceptées.")
    host = (parsed.hostname or "").lower()
    allowed = get_settings().allowed_hosts_list
    if host not in allowed:
        raise ImportErrorFatal(
            f"Hôte « {host} » non autorisé. Hôtes autorisés : {', '.join(allowed) or 'aucun'} "
            "(variable EM_ALLOWED_IMPORT_HOSTS)."
        )


def fetch_url(url: str) -> tuple[bytes, str]:
    import httpx

    check_url_allowed(url)
    settings = get_settings()
    limit = int(settings.max_upload_mb * 1024 * 1024)
    try:
        with httpx.Client(timeout=settings.url_timeout_s, follow_redirects=False) as client:
            current = url
            for _ in range(4):
                with client.stream("GET", current, headers={"User-Agent": "EuroMillionsQuantumAnalytics/1.0"}) as resp:
                    if resp.is_redirect:
                        current = str(resp.next_request.url) if resp.next_request else ""
                        check_url_allowed(current)
                        continue
                    if resp.status_code != 200:
                        raise ImportErrorFatal(f"La source a répondu {resp.status_code}. Utilisez l'import manuel.")
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in resp.iter_bytes():
                        size += len(chunk)
                        if size > limit:
                            raise ImportErrorFatal("Fichier distant trop volumineux.")
                        chunks.append(chunk)
                    filename = urlparse(current).path.rsplit("/", 1)[-1] or "source.csv"
                    ctype = resp.headers.get("content-type", "")
                    if _ext(filename) not in ALLOWED_EXTENSIONS:
                        filename += ".zip" if "zip" in ctype else ".csv"
                    return b"".join(chunks), filename
            raise ImportErrorFatal("Trop de redirections.")
    except httpx.HTTPError as exc:
        raise ImportErrorFatal(
            f"Source inaccessible ({exc.__class__.__name__}). Vérifiez la connexion ou utilisez l'import manuel d'un fichier."
        ) from exc
