import io

import pytest

from tests.conftest import wait_job


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_probabilities(client):
    r = client.get("/api/math/probabilities").json()
    assert r["total_combinations"] == 139_838_160
    assert r["jackpot"]["one_in"] == "1 chance sur 139 838 160"
    assert len(r["tiers"]) == 13
    p = client.get("/api/math/portfolio", params={"n_grids": 10, "n_draws": 104}).json()
    assert p["single_draw"]["numerator"] * 139_838_160 == 10 * p["single_draw"]["denominator"] and p["horizon_exact"]


def test_import_and_summary(client, demo_loaded):
    assert demo_loaded["inserted"] > 1900 and demo_loaded["is_demo"]
    s = client.get("/api/draws/summary").json()
    assert s["is_demo"] and s["demo_warning"]
    assert set(s["eras"]) == {"E2004", "E2011", "E2016"}
    r = client.get("/api/draws", params={"page": 1, "page_size": 10}).json()
    assert len(r["items"]) == 10 and r["total"] == s["count"]
    # Réimport : doublons ignorés.
    again = client.post("/api/draws/import/demo").json()
    assert again["inserted"] == 0 and again["duplicates_skipped"] >= 1900


def test_cannot_mix_demo_and_real(client, demo_loaded):
    csv = b"date;n1;n2;n3;n4;n5;e1;e2\n03/01/2020;1;2;3;4;5;1;2\n"
    r = client.post("/api/draws/import/file", files={"file": ("vrai.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 400 and "fictives" in r.json()["detail"]


def test_upload_rejections(client):
    r = client.post("/api/draws/import/file", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")})
    assert r.status_code == 400
    r = client.post("/api/draws/import/url", json={"url": "https://evil.example.com/a.csv"})
    assert r.status_code == 400 and "non autorisé" in r.json()["detail"]


def test_statistics_endpoints(client, demo_loaded):
    for path in ["", "/numbers", "/stars", "/hot-cold", "/gaps", "/pairs", "/triples", "/star-pairs", "/cooccurrence",
                 "/parity", "/sums", "/decades", "/spacing", "/consecutive", "/repeats", "/tests", "/history"]:
        r = client.get(f"/api/statistics{path}", params={"last_n": 500})
        assert r.status_code == 200, (path, r.text)
    hc = client.get("/api/statistics/hot-cold", params={"window": 20}).json()
    assert "ne permettent pas de conclure" in hc["warning"]
    for fmt in ("csv", "xlsx", "json", "pdf"):
        r = client.get("/api/statistics/export", params={"section": "numbers", "format": fmt})
        assert r.status_code == 200 and len(r.content) > 100


def test_generate_sync_and_job(client, demo_loaded):
    r = client.post("/api/grids/generate", json={"count": 10, "strategy": "A", "seed": 1})
    assert r.status_code == 200
    res = r.json()["result"]
    assert res["count"] == 10
    r = client.post("/api/grids/generate", json={"count": 8, "strategy": "C", "time_limit_s": 0.5, "seed": 2})
    res = wait_job(client, r.json())
    assert res["count"] == 8
    r = client.post("/api/grids/generate", json={"count": 5, "strategy": "E", "seed": 3})
    assert "aucun avantage prédictif" in " ".join(r.json()["result"]["warnings"])


@pytest.mark.parametrize("body", [
    {"count": 0},
    {"count": 10_001},
    {"count": 5, "strategy": "Z"},
    {"count": 5, "seed": -1},
    {"count": 5, "constraints": {"exclude_numbers": [51]}},
    {"count": 5, "unknown_field": 1},
])
def test_generate_validation(client, body):
    assert client.post("/api/grids/generate", json=body).status_code in (400, 422)


def test_validate_grid(client):
    assert client.post("/api/grids/validate", json={"numbers": [5, 4, 3, 2, 1], "stars": [2, 1]}).json()["numbers"] == [1, 2, 3, 4, 5]
    assert client.post("/api/grids/validate", json={"numbers": [1, 1, 3, 4, 5], "stars": [1, 2]}).status_code == 422


def test_portfolio_crud_and_export(client):
    grids = [{"numbers": [1, 2, 3, 4, 5], "stars": [1, 2]}, {"numbers": [6, 7, 8, 9, 10], "stars": [3, 4]}]
    r = client.post("/api/portfolios", json={"name": "Test", "grids": grids})
    assert r.status_code == 201
    pid = r.json()["id"]
    dup = client.post("/api/portfolios", json={"name": "Dup", "grids": grids + grids[:1]})
    assert dup.status_code == 400
    p = client.get(f"/api/portfolios/{pid}").json()
    assert p["n_grids"] == 2 and p["metrics"]["duplicates"] == 0
    assert client.post(f"/api/portfolios/{pid}/grids", json=grids[0]).status_code == 409
    g = client.post(f"/api/portfolios/{pid}/grids", json={"numbers": [11, 12, 13, 14, 15], "stars": [5, 6]})
    assert g.status_code == 201
    assert client.delete(f"/api/portfolios/{pid}/grids/{g.json()['id']}").status_code == 204
    for fmt in ("csv", "xlsx", "json", "pdf"):
        r = client.get(f"/api/portfolios/{pid}/export", params={"format": fmt})
        assert r.status_code == 200 and len(r.content) > 50
    assert client.patch(f"/api/portfolios/{pid}", json={"name": "Renommé"}).json()["name"] == "Renommé"
    saved = client.post("/api/grids/save", json={"numbers": [20, 21, 22, 23, 24], "stars": [1, 12]})
    assert saved.status_code == 201
    assert client.post("/api/grids/save", json={"numbers": [20, 21, 22, 23, 24], "stars": [1, 12]}).status_code == 409
    assert client.delete(f"/api/portfolios/{pid}").status_code == 204
    assert client.get(f"/api/portfolios/{pid}").status_code == 404


def _make_portfolio(client, name, seed, n=5):
    res = client.post("/api/grids/generate", json={"count": n, "strategy": "A", "seed": seed}).json()["result"]
    r = client.post("/api/portfolios", json={"name": name, "seed": seed, "grids": [
        {"numbers": g["numbers"], "stars": g["stars"]} for g in res["grids"]]})
    return r.json()["id"]


def test_optimize_compare_candidates(client):
    r = client.post("/api/portfolios/optimize", json={"n_grids": 6, "method": "simulated_annealing", "time_limit_s": 0.5})
    res = wait_job(client, r.json())
    assert len(res["grids"]) == 6 and res["duplicates"] == 0
    r = client.post("/api/portfolios/compare-methods", json={"n_grids": 5, "time_limit_s": 0.2,
                                                             "methods": ["greedy", "tabu"]})
    assert len(wait_job(client, r.json())["results"]) == 2
    r = client.post("/api/portfolios/candidates", json={"n_grids": 5, "time_limit_s": 0.2})
    assert len(wait_job(client, r.json())["candidates"]) == 4
    r = client.post("/api/portfolios/optimize", json={"n_grids": 50, "budget": 10, "time_limit_s": 0.2})
    assert len(wait_job(client, r.json())["grids"]) == 4  # budget 10 € / 2,50 €


def test_simulation_flow(client):
    pid = _make_portfolio(client, "Sim", 7)
    r = client.post("/api/simulations/run", json={"portfolio_ids": [pid], "random_baselines": [5], "n_draws": 20_000,
                                                  "seed": 1, "payouts": {"13": 4.0}})
    assert r.status_code == 200
    sid = r.json()["simulation_id"]
    wait_job(client, r.json())
    s = client.get(f"/api/simulations/{sid}").json()
    assert s["status"] == "done" and len(s["results"]["portfolios"]) == 2
    assert s["seed"] == 1
    for fmt in ("csv", "pdf"):
        assert client.get(f"/api/simulations/{sid}/export", params={"format": fmt}).status_code == 200
    too_big = client.post("/api/simulations/run", json={"random_baselines": [10_000], "n_draws": 5_000_000})
    assert too_big.status_code == 400


def test_exact_portfolio_and_budget(client):
    pid = _make_portfolio(client, "Exact", 8, n=3)
    r = client.post("/api/math/exact-portfolio", json={"portfolio_id": pid})
    res = wait_job(client, r.json())
    assert len(res["tiers"]) == 13
    b = client.get("/api/budget/probabilities", params={"portfolio_id": pid, "duration_weeks": 10}).json()
    assert b["n_grids"] == 3 and "p_any_win_per_draw" in b["secondary"]


def test_compare_portfolios(client):
    a, b = _make_portfolio(client, "A", 21), _make_portfolio(client, "B", 22, n=8)
    r = client.post("/api/portfolios/compare", json={"portfolio_a": a, "portfolio_b": b, "n_draws": 5000, "seed": 3})
    res = wait_job(client, r.json())
    crit = {c["criterion"]: c for c in res["criteria"]}
    assert crit["Probabilité de jackpot"]["dominant"] == "B"
    assert crit["Budget par tirage (€)"]["dominant"] == "A"
    assert "Aucun « meilleur portefeuille »" in res["note"]


def test_results_check(client, demo_loaded):
    draws = client.get("/api/draws", params={"page_size": 1}).json()["items"]
    d = draws[0]
    grids = [{"numbers": d["numbers"], "stars": d["stars"]}]
    r = client.post("/api/results/check", json={"draw_id": d["id"], "grids": grids}).json()
    assert r["lines"][0]["rank"] == 1 and r["lines"][0]["prize"] is None
    r2 = client.post("/api/results/check", json={"numbers": [1, 2, 3, 4, 5], "stars": [1, 2], "grids": [
        {"numbers": [1, 2, 3, 40, 41], "stars": [1, 9]}], "save": False}).json()
    assert r2["lines"][0]["rank"] == 9
    hist = client.get("/api/results/history").json()
    assert len(hist) >= 1
    assert client.get(f"/api/results/history/{hist[0]['id']}").status_code == 200


def test_jackpot_endpoints(client):
    r = client.post("/api/jackpot/analysis", json={"jackpot": 130_000_000, "n_grids": 2, "secondary_payouts": {"13": 4}})
    assert r.status_code == 200 and r.json()["ev_net"] < 0
    r = client.post("/api/jackpot/analysis", json={"use_historical_payouts": True})
    assert r.status_code == 400  # données fictives sans barème : rien n'est inventé


def test_ml_research_audit_endpoints(client, demo_loaded):
    r = client.post("/api/ml/run", json={"models": ["hot", "random"], "seed": 1, "n_bootstrap": 100})
    res = wait_job(client, r.json())
    assert res["any_model_beats_random"] is False
    assert len(client.get("/api/ml/experiments").json()) >= 1
    body = {"hypothesis": "sum_mean", "mode": "exploratory", "date_from": "2018-01-01", "date_to": "2020-12-31",
            "n_sim": 200, "seed": 4}
    wait_job(client, client.post("/api/research/experiments", json=body).json())
    exps = client.get("/api/research/experiments").json()
    eid = exps[0]["id"]
    # Confirmatoire sur une période déjà explorée : refusé.
    conf = client.post("/api/research/experiments", json={**body, "mode": "confirmatory"})
    assert conf.status_code == 409
    ok = client.post("/api/research/experiments", json={**body, "mode": "confirmatory", "date_from": "2023-01-01",
                                                        "date_to": "2026-12-31"})
    assert ok.status_code == 200
    wait_job(client, ok.json())
    rep = wait_job(client, client.post(f"/api/research/experiments/{eid}/reproduce").json())
    assert rep["identical"] is True
    assert client.get(f"/api/research/experiments/{eid}/export", params={"format": "pdf"}).status_code == 200


def test_strategy_lab(client):
    r = client.post("/api/strategy-lab/evaluate", json={"n_grids": 5, "time_limit_s": 0.3, "seed": 1})
    assert r.status_code == 200 and "pair_coverage" in r.json()["scores"]
    s = client.post("/api/strategies", json={"name": "Ma stratégie", "params": {"weights": {"pairs": 1}}})
    assert s.status_code == 201
    assert client.post("/api/strategies", json={"name": "Ma stratégie"}).status_code == 409
    cmp_ = client.post("/api/strategy-lab/compare", json={"configs": [{"name": "a"}, {"name": "b", "weights": {"pairs": 2}}],
                                                         "n_grids": 5, "time_limit_s": 0.2, "seed": 2})
    assert len(wait_job(client, cmp_.json())["results"]) == 2
    tune = client.post("/api/strategy-lab/auto-tune", json={"n_grids": 5, "trials": 2, "time_per_trial_s": 0.2, "seed": 1})
    assert wait_job(client, tune.json())["best"] is not None
    assert client.delete(f"/api/strategies/{s.json()['id']}").status_code == 204


def test_settings(client):
    r = client.put("/api/settings", json={"ticket_price": 3.0})
    assert r.json()["ticket_price"] == 3.0
    assert client.put("/api/settings", json={"ticket_price": -1}).status_code == 422
    client.put("/api/settings", json={"ticket_price": 2.5})


def test_jobs_cancel(client):
    r = client.post("/api/portfolios/optimize", json={"n_grids": 20, "time_limit_s": 30})
    jid = r.json()["job"]["id"]
    client.post(f"/api/jobs/{jid}/cancel")
    from app.services.jobs import get_job_manager

    job = get_job_manager().wait(jid, 10)
    assert job.status == "cancelled"
    assert client.get("/api/jobs/inconnu").status_code == 404


def test_api_key_and_rate_limit(client, monkeypatch):
    from app.config import get_settings
    from app.security import rate_limiter

    s = get_settings()
    monkeypatch.setattr(s, "api_key", "secret-test")
    assert client.get("/api/settings").status_code == 401
    assert client.get("/api/settings", headers={"X-API-Key": "secret-test"}).status_code == 200
    assert client.get("/api/health").status_code == 200
    monkeypatch.setattr(s, "api_key", None)
    monkeypatch.setattr(s, "rate_limit_per_minute", 2)
    rate_limiter.reset()
    codes = [client.post("/api/grids/generate", json={"count": 1}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    rate_limiter.reset()


def test_audit_endpoint(client):
    r = client.post("/api/audit/run")
    res = wait_job(client, r.json(), timeout=300)
    assert res["total"] == 8
    failed = [c for c in res["checks"] if not c["passed"]]
    assert not failed, failed
    reports = client.get("/api/audit/reports").json()
    rid = reports[0]["id"]
    assert client.get(f"/api/audit/reports/{rid}/export", params={"format": "pdf"}).content[:4] == b"%PDF"
