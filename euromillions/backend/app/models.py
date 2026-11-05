"""Modèles SQLAlchemy (schéma portable SQLite / PostgreSQL)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DataSource(Base):
    """Origine d'un lot de tirages importés."""

    __tablename__ = "data_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # csv | excel | url | manual | demo
    location: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    rows_inserted: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    rows_duplicated: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (CheckConstraint("kind IN ('csv','excel','url','manual','demo')", name="ck_source_kind"),)


class Draw(Base):
    """Tirage historique. Les numéros et étoiles sont stockés triés."""

    __tablename__ = "draws"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draw_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    era_code: Mapped[str] = mapped_column(String(10), index=True)
    n1: Mapped[int] = mapped_column(Integer)
    n2: Mapped[int] = mapped_column(Integer)
    n3: Mapped[int] = mapped_column(Integer)
    n4: Mapped[int] = mapped_column(Integer)
    n5: Mapped[int] = mapped_column(Integer)
    s1: Mapped[int] = mapped_column(Integer)
    s2: Mapped[int] = mapped_column(Integer)
    stars_max: Mapped[int] = mapped_column(Integer)
    jackpot_eur: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    source: Mapped[DataSource | None] = relationship()
    prizes: Mapped[list["DrawPrize"]] = relationship(
        back_populates="draw", cascade="all, delete-orphan", order_by="DrawPrize.rank"
    )

    __table_args__ = (
        CheckConstraint("n1 >= 1 AND n5 <= 50 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5", name="ck_draw_numbers"),
        CheckConstraint("s1 >= 1 AND s1 < s2 AND s2 <= stars_max", name="ck_draw_stars"),
        CheckConstraint("stars_max IN (9, 11, 12)", name="ck_draw_stars_max"),
    )

    @property
    def numbers(self) -> list[int]:
        return [self.n1, self.n2, self.n3, self.n4, self.n5]

    @property
    def stars(self) -> list[int]:
        return [self.s1, self.s2]


class DrawPrize(Base):
    """Nombre de gagnants et gain par rang, tels que fournis par la source (jamais inventés)."""

    __tablename__ = "draw_prizes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draw_id: Mapped[int] = mapped_column(ForeignKey("draws.id", ondelete="CASCADE"), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    winners: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prize_eur: Mapped[float | None] = mapped_column(Float, nullable=True)

    draw: Mapped[Draw] = relationship(back_populates="prizes")

    __table_args__ = (
        UniqueConstraint("draw_id", "rank", name="uq_draw_prize_rank"),
        CheckConstraint("rank BETWEEN 1 AND 13", name="ck_prize_rank"),
    )


class Strategy(Base):
    """Configuration de stratégie enregistrée (laboratoire de stratégies)."""

    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    code: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    strategy_code: Mapped[str] = mapped_column(String(20), default="A")
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    seed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    objective: Mapped[float | None] = mapped_column(Float, nullable=True)
    ticket_price: Mapped[float] = mapped_column(Float, default=2.5)
    is_individual: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    grids: Mapped[list["SavedGrid"]] = relationship(
        back_populates="portfolio", cascade="all, delete-orphan", order_by="SavedGrid.id"
    )


class SavedGrid(Base):
    __tablename__ = "grids"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    combo_index: Mapped[int] = mapped_column(BigInteger)
    n1: Mapped[int] = mapped_column(Integer)
    n2: Mapped[int] = mapped_column(Integer)
    n3: Mapped[int] = mapped_column(Integer)
    n4: Mapped[int] = mapped_column(Integer)
    n5: Mapped[int] = mapped_column(Integer)
    s1: Mapped[int] = mapped_column(Integer)
    s2: Mapped[int] = mapped_column(Integer)
    strategy_code: Mapped[str] = mapped_column(String(20), default="A")
    diversity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    portfolio: Mapped[Portfolio] = relationship(back_populates="grids")

    __table_args__ = (
        UniqueConstraint("portfolio_id", "combo_index", name="uq_portfolio_grid"),
        CheckConstraint("n1 >= 1 AND n5 <= 50 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5", name="ck_grid_numbers"),
        CheckConstraint("s1 >= 1 AND s1 < s2 AND s2 <= 12", name="ck_grid_stars"),
    )

    @property
    def numbers(self) -> list[int]:
        return [self.n1, self.n2, self.n3, self.n4, self.n5]

    @property
    def stars(self) -> list[int]:
        return [self.s1, self.s2]


class Simulation(Base):
    __tablename__ = "simulations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    seed: Mapped[int] = mapped_column(BigInteger)
    n_draws: Mapped[int] = mapped_column(Integer)
    results: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending','running','done','error','cancelled')", name="ck_sim_status"),
        CheckConstraint("n_draws > 0", name="ck_sim_draws"),
    )


class ResultCheck(Base):
    """Vérification d'un ensemble de grilles contre un tirage officiel."""

    __tablename__ = "result_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draw_id: Mapped[int | None] = mapped_column(ForeignKey("draws.id", ondelete="SET NULL"), nullable=True)
    draw_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    numbers: Mapped[list[int]] = mapped_column(JSON)
    stars: Mapped[list[int]] = mapped_column(JSON)
    portfolio_id: Mapped[int | None] = mapped_column(ForeignKey("portfolios.id", ondelete="SET NULL"), nullable=True)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    lines: Mapped[list["GridResult"]] = relationship(back_populates="check", cascade="all, delete-orphan")


class GridResult(Base):
    __tablename__ = "grid_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_id: Mapped[int] = mapped_column(ForeignKey("result_checks.id", ondelete="CASCADE"), index=True)
    grid_id: Mapped[int | None] = mapped_column(ForeignKey("grids.id", ondelete="SET NULL"), nullable=True)
    numbers: Mapped[list[int]] = mapped_column(JSON)
    stars: Mapped[list[int]] = mapped_column(JSON)
    matched_numbers: Mapped[int] = mapped_column(Integer)
    matched_stars: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prize_eur: Mapped[float | None] = mapped_column(Float, nullable=True)

    check: Mapped[ResultCheck] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint("matched_numbers BETWEEN 0 AND 5", name="ck_gr_numbers"),
        CheckConstraint("matched_stars BETWEEN 0 AND 2", name="ck_gr_stars"),
    )


class AppSetting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Report(Base):
    """Rapport enregistré (audit, statistiques…) ; le fichier est régénéré à l'export."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Experiment(Base):
    """Expérience du mode recherche ou du laboratoire IA (graine enregistrée)."""

    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # research | ml
    hypothesis_code: Mapped[str] = mapped_column(String(60))
    mode: Mapped[str] = mapped_column(String(20), default="exploratory")  # exploratory | confirmatory
    title: Mapped[str] = mapped_column(String(300))
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    seed: Mapped[int] = mapped_column(BigInteger)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint("kind IN ('research','ml')", name="ck_exp_kind"),
        CheckConstraint("mode IN ('exploratory','confirmatory')", name="ck_exp_mode"),
    )
