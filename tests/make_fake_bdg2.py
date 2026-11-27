"""Writes a SMALL synthetic folder in the exact BDG2 file format, so validate_bdg2.py can be smoke-tested without the 175 MB download.
(Synthetic data — it checks the plumbing only; it says nothing about real accuracy.)"""
import os, sys, numpy as np, pandas as pd
root = sys.argv[1]; os.makedirs(f"{root}/data/metadata", exist_ok=True); os.makedirs(f"{root}/data/meters/cleaned", exist_ok=True); os.makedirs(f"{root}/data/weather", exist_ok=True)
idx = pd.date_range("2016-01-01", "2017-12-31 23:00", freq="h"); rng = np.random.default_rng(1)
sites = ["Fox", "Rat"]; wx = []
for s in sites:
    t = 15 + 10 * np.sin(2 * np.pi * (idx.dayofyear - 110) / 365) + 4 * np.sin(2 * np.pi * (idx.hour - 9) / 24) + rng.normal(0, 1, len(idx))
    wx.append(pd.DataFrame({"timestamp": idx, "site_id": s, "airTemperature": t, "cloudCoverage": 0, "dewTemperature": t - 6, "precipDepth1HR": 0, "precipDepth6HR": 0, "seaLvlPressure": 1013, "windDirection": 0, "windSpeed": 2}))
pd.concat(wx).to_csv(f"{root}/data/weather/weather.csv", index=False)
cols, meta = {}, []
for b in range(14):
    site = sites[b % 2]; t = wx[b % 2]["airTemperature"].values; hr = idx.hour.values; wk = idx.dayofweek.values < 5
    base = 80 + 30 * b; shape = 0.35 + 0.65 * ((hr >= 8) & (hr < 18) & wk) + 0.01 * np.maximum(t - 18, 0)
    y = base * shape * (1 + rng.normal(0, 0.04, len(idx))); y[rng.random(len(idx)) < 0.01] = np.nan
    name = f"{site}_{['office','retail','lodging','education'][b % 4]}_B{b}"; cols[name] = y
    meta.append({"building_id": name, "site_id": site, "primaryspaceusage": ["Office", "Retail", "Lodging/residential", "Education"][b % 4], "sqm": 5000 + 400 * b})
e = pd.DataFrame(cols, index=idx); e.index.name = "timestamp"; e.to_csv(f"{root}/data/meters/cleaned/electricity_cleaned.csv")
pd.DataFrame(meta).to_csv(f"{root}/data/metadata/metadata.csv", index=False); print("fake BDG2-format data in", root)
