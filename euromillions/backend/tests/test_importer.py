import io
import zipfile
from datetime import date

import pandas as pd
import pytest

from app.services.importer import (
    ImportErrorFatal,
    check_url_allowed,
    detect_columns,
    parse_amount,
    parse_dataframe,
    parse_date,
    read_table,
)


def _df(csv_text: str) -> pd.DataFrame:
    return read_table(csv_text.encode("utf-8"), "f.csv")


def test_generic_csv_ok():
    rep = parse_dataframe(_df("date,n1,n2,n3,n4,n5,e1,e2\n2020-01-03,5,1,30,22,49,12,3\n"))
    assert len(rep.draws) == 1 and not rep.errors
    d = rep.draws[0]
    assert d.numbers == (1, 5, 22, 30, 49) and d.stars == (3, 12)


def test_fdj_format_with_prizes():
    text = (
        "annee_numero_de_tirage;jour_de_tirage;date_de_tirage;boule_1;boule_2;boule_3;boule_4;boule_5;etoile_1;etoile_2;"
        "nombre_de_gagnant_au_rang1_Euro_Millions_en_europe;nombre_de_gagnant_au_rang1_Euro_Millions_en_france;"
        "rapport_du_rang1_Euro_Millions;rapport_du_rang13_Euro_Millions\n"
        "2020001;VENDREDI;03/01/2020;5;1;30;22;49;12;3;0;0;0;4,30\n"
    )
    rep = parse_dataframe(_df(text))
    assert len(rep.draws) == 1, rep.issues
    assert rep.draws[0].prizes[13] == (None, 4.30)
    assert rep.draws[0].prizes[1] == (0, 0.0)


def test_invalid_rows_rejected():
    text = (
        "date;n1;n2;n3;n4;n5;e1;e2\n"
        "03/01/2020;1;2;3;4;4;1;2\n"  # doublon de numéro
        "03/01/2020x;1;2;3;4;5;1;2\n"  # date invalide
        "07/01/2020;1;2;3;4;51;1;2\n"  # hors bornes
        "10/01/2020;1;2;3;4;5;1;13\n"  # étoile hors bornes
        "14/01/2020;1;2;3;4;;1;2\n"  # valeur manquante
        "17/01/2020;1;2;3;4;a;1;2\n"  # non numérique
        "01/01/2099;1;2;3;4;5;1;2\n"  # futur
        "01/01/2003;1;2;3;4;5;1;2\n"  # avant 2004
    )
    rep = parse_dataframe(_df(text))
    assert len(rep.draws) == 0
    assert len(rep.errors) == 8


def test_era_star_rules():
    # 2010 : étoiles 1 à 9 seulement ; 2014 : 1 à 11 ; 2020 : 1 à 12
    text = (
        "date;n1;n2;n3;n4;n5;e1;e2\n"
        "05/02/2010;1;2;3;4;5;1;10\n"
        "07/02/2014;1;2;3;4;5;1;11\n"
        "04/02/2014;1;2;3;4;5;1;12\n"
        "07/02/2020;1;2;3;4;5;1;12\n"
    )
    rep = parse_dataframe(_df(text))
    assert [d.draw_date for d in rep.draws] == [date(2014, 2, 7), date(2020, 2, 7)]
    assert len(rep.errors) == 2
    assert rep.draws[0].era.stars_max == 11


def test_duplicates_in_file():
    text = "date;n1;n2;n3;n4;n5;e1;e2\n03/01/2020;1;2;3;4;5;1;2\n03/01/2020;1;2;3;4;5;1;2\n03/01/2020;1;2;3;4;6;1;2\n"
    rep = parse_dataframe(_df(text))
    assert len(rep.draws) == 1
    assert rep.duplicates_in_file == 1
    assert len(rep.errors) == 1  # conflit


def test_weekday_warning():
    rep = parse_dataframe(_df("date;n1;n2;n3;n4;n5;e1;e2\n04/01/2020;1;2;3;4;5;1;2\n"))  # samedi
    assert len(rep.draws) == 1 and len(rep.warnings) == 1


def test_missing_columns():
    with pytest.raises(ImportErrorFatal):
        parse_dataframe(_df("date;a;b\n2020-01-03;1;2\n"))


def test_excel_and_zip():
    df = pd.DataFrame([{"date": "2020-01-03", "n1": 1, "n2": 2, "n3": 3, "n4": 4, "n5": 5, "e1": 1, "e2": 2}])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    rep = parse_dataframe(read_table(buf.getvalue(), "x.xlsx"))
    assert len(rep.draws) == 1
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("tirages.csv", "date;n1;n2;n3;n4;n5;e1;e2\n03/01/2020;1;2;3;4;5;1;2\n")
    rep = parse_dataframe(read_table(z.getvalue(), "x.zip"))
    assert len(rep.draws) == 1


def test_file_security_checks():
    with pytest.raises(ImportErrorFatal):
        read_table(b"date,n1\n", "evil.exe")
    with pytest.raises(ImportErrorFatal):
        read_table(b"\x00\x01binary", "x.csv")
    with pytest.raises(ImportErrorFatal):
        read_table(b"not a zip", "x.xlsx")
    with pytest.raises(ImportErrorFatal):
        read_table(b"x" * (11 * 1024 * 1024), "big.csv")


def test_url_allowlist():
    check_url_allowed("https://www.fdj.fr/x.zip")
    for bad in ("http://www.fdj.fr/x.zip", "https://evil.example.com/x.csv", "https://127.0.0.1/x", "file:///etc/passwd"):
        with pytest.raises(ImportErrorFatal):
            check_url_allowed(bad)


def test_parsers():
    assert parse_date("13/02/2004") == date(2004, 2, 13)
    assert parse_date("20040213") == date(2004, 2, 13)
    assert parse_amount("1 234,56 €") == 1234.56
    assert parse_amount("1.234,56") == 1234.56
    assert parse_amount("") is None
    cols = detect_columns(["Date de tirage", "Boule 1", "Boule 2", "Boule 3", "Boule 4", "Boule 5", "Étoile 1", "Étoile 2"])
    assert cols["date"] == "Date de tirage"


def test_trailing_delimiter_rows_fdj_2016_2019():
    """Fichier FDJ 2016-2019 : chaque ligne de données a un « ; » final de plus que l'en-tête."""
    text = (
        "annee_numero_de_tirage;jour_de_tirage;date_de_tirage;numero_de_tirage_dans_le_cycle;boule_1;boule_2;boule_3;"
        "boule_4;boule_5;etoile_1;etoile_2\n"
        "2016078;MARDI   ;27/09/2016;1;41;6;13;39;9;2;12;\n"
        "2016079;VENDREDI;30/09/2016;Super Jackpot et tirages suivants;35;44;17;37;43;10;2;\n"
    )
    rep = parse_dataframe(_df(text))
    assert not rep.errors, [i.message for i in rep.errors]
    assert [d.draw_date for d in rep.draws] == [date(2016, 9, 27), date(2016, 9, 30)]
    assert rep.draws[0].numbers == (6, 9, 13, 39, 41) and rep.draws[0].stars == (2, 12)


def test_other_games_prize_columns_ignored():
    """Les rapports Étoile+ / Joker+ ne doivent jamais être pris pour ceux de l'EuroMillions, quel que soit l'ordre."""
    text = (
        "date_de_tirage;boule_1;boule_2;boule_3;boule_4;boule_5;etoile_1;etoile_2;"
        "nombre_de_gagnant_au_rang1_Etoile+;rapport_du_rang1_Etoile+;rapport_du_rang2_Joker+;"
        "nombre_de_gagnant_au_rang1_Euro_Millions_en_europe;rapport_du_rang1_Euro_Millions;rapport_du_rang2_Euro_Millions\n"
        "03/01/2020;1;2;3;4;5;1;2;7;999,00;888,00;0;0,00;123456,70\n"
    )
    rep = parse_dataframe(_df(text))
    assert rep.draws[0].prizes[1] == (0, 0.0)
    assert rep.draws[0].prizes[2] == (None, 123456.70)


def test_fdj_file_host_allowed_by_default():
    check_url_allowed("https://www.sto.api.fdj.fr/anonymous/service-draw-info/v3/documentations/abc")
