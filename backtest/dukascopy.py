"""Downloads real historical prices from Dukascopy's public data feed (no key needed).

Gold (XAU/USD): bid and ask 1-minute candles, aggregated into 15-minute mid-price candles with
the measured spread. Silver (XAG/USD) and EUR/USD: hourly candles, for the AI's intermarket radar.

    python3 backtest/dukascopy.py --years 5 --out backtest/data
"""
import argparse
import json
import lzma
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

BASE = "https://datafeed.dukascopy.com/datafeed"
EXPECTED = {"XAUUSD": (500, 10000), "XAGUSD": (5, 200), "EURUSD": (0.5, 2.0)}


MISSING = []


def fetch(url, tries=8):
    """The feed throttles bursts: retry with a growing pause. A file that still fails is skipped
    (and counted) rather than stopping five years of downloads for one day."""
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (AURUM backtest)"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b""
        except Exception:
            pass
        time.sleep(min(60, 2 * 2**k))
    MISSING.append(url)
    print(f"  manquant après {tries} essais : {url}", flush=True)
    return b""


def decode(raw):
    """Candle records: big-endian int32 seconds offset, open, close, low, high (in points), float32 volume."""
    if not raw:
        return []
    data = lzma.decompress(raw)
    out = []
    for i in range(0, len(data) - 23, 24):
        t, o, c, lo, hi, v = struct.unpack(">5if", data[i : i + 24])
        out.append((t, o, c, lo, hi, v))
    return out


def factor_for(symbol, rows):
    lo, hi = EXPECTED[symbol]
    mids = sorted(r[1] for r in rows if r[1] > 0)
    if not mids:
        return None
    med = mids[len(mids) // 2]
    for f in (10, 100, 1000, 10000, 100000, 1000000):
        if lo <= med / f <= hi:
            return f
    raise RuntimeError(f"{symbol}: prix incohérent ({med})")


def minute_day(symbol, side, d):
    url = f"{BASE}/{symbol}/{d.year}/{d.month - 1:02d}/{d.day:02d}/{side}_candles_min_1.bi5"
    start = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
    return [(start + r[0], *r[1:]) for r in decode(fetch(url))]


def hour_month(symbol, y, m):
    url = f"{BASE}/{symbol}/{y}/{m - 1:02d}/BID_candles_hour_1.bi5"
    start = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp())
    return [(start + r[0], *r[1:]) for r in decode(fetch(url))]


def gold_m15(days, workers):
    bars = {}
    factor = None
    done = 0

    def job(d):
        return d, minute_day("XAUUSD", "BID", d), minute_day("XAUUSD", "ASK", d)

    with ThreadPoolExecutor(workers) as ex:
        for d, bid, ask in ex.map(job, days):
            done += 1
            if done % 100 == 0:
                print(f"  or : {done}/{len(days)} jours", flush=True)
            if not bid or not ask:
                continue
            if factor is None:
                factor = factor_for("XAUUSD", bid)
                print(f"  or : 1 point = 1/{factor} $", flush=True)
            askmap = {r[0]: r for r in ask}
            for t, o, c, lo, hi, v in bid:
                a = askmap.get(t)
                if a is None or v <= 0:  # no trading in that minute (market closed)
                    continue
                k = t - t % 900
                mid = lambda x, y: (x + y) / 2 / factor
                bo, bc, bl, bh = mid(o, a[1]), mid(c, a[2]), mid(lo, a[3]), mid(hi, a[4])
                spread = (a[2] - c) / factor
                b = bars.get(k)
                if b is None:
                    bars[k] = {"t": k * 1000, "o": bo, "h": bh, "l": bl, "c": bc, "v": v, "s": spread, "n": 1}
                else:
                    b["h"] = max(b["h"], bh)
                    b["l"] = min(b["l"], bl)
                    b["c"] = bc
                    b["v"] += v
                    b["s"] += spread
                    b["n"] += 1
    out = []
    for k in sorted(bars):
        b = bars[k]
        out.append({"t": b["t"], "o": round(b["o"], 3), "h": round(b["h"], 3), "l": round(b["l"], 3), "c": round(b["c"], 3), "v": round(b["v"], 2), "s": round(b["s"] / b["n"], 4)})
    return out


def gold_m1(days, workers):
    """1-minute gold candles for scalping tests: [unix seconds, open, high, low, close, spread], mid
    prices in dollars, spread (ask - bid) at the minute's close."""
    rows = []
    factor = None
    done = 0

    def job(d):
        return d, minute_day("XAUUSD", "BID", d), minute_day("XAUUSD", "ASK", d)

    with ThreadPoolExecutor(workers) as ex:
        for d, bid, ask in ex.map(job, days):
            done += 1
            if done % 50 == 0:
                print(f"  or M1 : {done}/{len(days)} jours", flush=True)
            if not bid or not ask:
                continue
            if factor is None:
                factor = factor_for("XAUUSD", bid)
            askmap = {r[0]: r for r in ask}
            for t, o, c, lo, hi, v in bid:
                a = askmap.get(t)
                if a is None or v <= 0:
                    continue
                f = 2 * factor
                rows.append([t, round((o + a[1]) / f, 3), round((hi + a[4]) / f, 3), round((lo + a[3]) / f, 3), round((c + a[2]) / f, 3), round((a[2] - c) / factor, 3)])
    rows.sort()
    return rows


def peer_h1(symbol, months, workers):
    rows = []
    with ThreadPoolExecutor(workers) as ex:
        for part in ex.map(lambda ym: hour_month(symbol, *ym), months):
            rows.extend(part)
    rows = [r for r in rows if r[5] > 0]
    if not rows:
        return []
    f = factor_for(symbol, rows)
    rows.sort()
    return [{"t": t * 1000, "o": o / f, "h": hi / f, "l": lo / f, "c": c / f, "v": v} for t, o, c, lo, hi, v in rows]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=float, default=5)
    ap.add_argument("--out", default="backtest/data")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--probe", action="store_true", help="decode one recent day and stop")
    ap.add_argument("--part", type=int, default=-1, help="with --parts: download only this slice of the period")
    ap.add_argument("--parts", type=int, default=1)
    ap.add_argument("--m1", action="store_true", help="gold 1-minute candles only (xau_m1.json), for scalping tests")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    end = date.today() - timedelta(days=1)
    if args.probe:
        d = end
        while d.weekday() >= 5:
            d -= timedelta(days=1)
        rows = minute_day("XAUUSD", "BID", d)
        f = factor_for("XAUUSD", rows)
        print(f"sonde {d} : {len(rows)} minutes, premier cours {rows[0][1] / f:.3f}, dernier {rows[-1][2] / f:.3f}")
        return
    start = end - timedelta(days=int(args.years * 365.25))
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    if args.part >= 0:  # one slice of the period, for parallel downloads on several machines
        size = -(-len(days) // args.parts)
        days = days[args.part * size : (args.part + 1) * size]
        start, end = days[0], days[-1]
    days = [d for d in days if d.weekday() != 5]  # Saturday: gold is closed
    print(f"or : {len(days)} jours du {start} au {end}", flush=True)
    if args.m1:
        m1 = gold_m1(days, args.workers)
        print(f"or : {len(m1)} bougies M1, fichiers manquants : {len(MISSING)}", flush=True)
        with open(os.path.join(args.out, "xau_m1.json"), "w") as fh:
            json.dump(m1, fh, separators=(",", ":"))
        if len(m1) < 1000 or len(MISSING) > 0.15 * 2 * len(days):
            sys.exit("trop de données manquantes")
        return
    gold = gold_m15(days, args.workers)
    print(f"or : {len(gold)} bougies M15", flush=True)
    months = sorted({(d.year, d.month) for d in days})
    xag = peer_h1("XAGUSD", months, args.workers)
    eur = peer_h1("EURUSD", months, args.workers)
    print(f"argent : {len(xag)} bougies H1, euro-dollar : {len(eur)} bougies H1", flush=True)
    for name, data in (("xau_m15", gold), ("xag_h1", xag), ("eur_h1", eur)):
        with open(os.path.join(args.out, f"{name}.json"), "w") as fh:
            json.dump(data, fh, separators=(",", ":"))
    print(f"fichiers manquants : {len(MISSING)}", flush=True)
    with open(os.path.join(args.out, "missing.json"), "w") as fh:
        json.dump({"missing": len(MISSING), "requested": 2 * len(days)}, fh)
    # a few missing days only leave gaps, like holidays; stop only when a large share is gone
    if len(gold) < (1000 if args.part < 0 else 100) or len(MISSING) > 0.15 * 2 * len(days):
        sys.exit("trop de données manquantes")


if __name__ == "__main__":
    main()
