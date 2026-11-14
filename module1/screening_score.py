"""第一層篩選分數：合併 GEE 匯出的 NDVI/NDBI，排出機構優先檢視順序。

目前分數（0–100，越高越優先）：
  環境分 = 標準化(NDBI) − 標準化(NDVI)   → 越不透水、越缺綠，長者步行熱負荷越高
之後加入：65 歲以上行人 A1/A2 事故、村里老化指數、機構規模（床數／醫院層級），權重放在 WEIGHTS。

用法：.venv/bin/python module1/screening_score.py [--indices data/raw/taoyuan_facility_indices.csv]
輸出：data/outputs/facility_screening_rank.csv
"""
import argparse

import pandas as pd

from common import DATA

WEIGHTS = {"env": 1.0}  # 之後加入 "accident"、"aging"、"scale"


def zscore(s):
    return (s - s.mean()) / (s.std(ddof=0) or 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--indices", default=str(DATA / "raw" / "taoyuan_facility_indices.csv"))
    args = ap.parse_args()

    df = pd.read_csv(args.indices)
    df["env"] = zscore(df["NDBI"]) - zscore(df["NDVI"])
    raw = sum(w * zscore(df[k]) for k, w in WEIGHTS.items())
    df["screening_score"] = ((raw - raw.min()) / ((raw.max() - raw.min()) or 1) * 100).round(1)
    df = df.sort_values("screening_score", ascending=False)
    df["rank"] = range(1, len(df) + 1)
    out = DATA / "outputs" / "facility_screening_rank.csv"
    df.to_csv(out, index=False, encoding="utf-8-sig")
    print(df[["rank", "name", "type", "NDVI", "NDBI", "screening_score"]].head(15).to_string(index=False))
    print(f"→ {out}")


if __name__ == "__main__":
    main()
