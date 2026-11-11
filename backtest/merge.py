"""Joins the slices downloaded in parallel (backtest/parts/*/) into backtest/data/."""
import glob
import json
import os
import sys

parts, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for name in ("xau_m15", "xag_h1", "eur_h1"):
    rows = {}
    for f in sorted(glob.glob(os.path.join(parts, "*", f"{name}.json"))):
        for r in json.load(open(f)):
            rows[r["t"]] = r
    merged = [rows[t] for t in sorted(rows)]
    with open(os.path.join(out, f"{name}.json"), "w") as fh:
        json.dump(merged, fh, separators=(",", ":"))
    print(f"{name} : {len(merged)} bougies")
