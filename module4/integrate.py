"""模組四：整合模組一～三與志工回饋，計算每個路段的綜合分數與 A–D 等級。

輸入
  data/outputs/<id>_severity.geojson     模組一路段（seg_id、level）
  data/module2/*.csv                     模組二車行偵測（docs/data-contract.md 的 drive_detections）
  data/module3/*.csv                     模組三遊戲／實走評分（walk_ratings）
  data/backend/feedback.json             志工回饋（地端後台）
輸出
  data/outputs/<id>_integrated.geojson   路段幾何＋composite_score、grade、components、counts
  data/outputs/<id>_priorities.csv       需改善路段清單（分數由高到低）

用法：.venv/bin/python module4/integrate.py --id taoyuan_hospital
權重在 config.yaml 的 integration 區段。
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from shapely.geometry import Point, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = {"tree-obstruction", "parked-vehicle", "broken-surface", "no-ramp", "tactile-broken",
            "too-narrow", "no-sidewalk", "pickup-problem", "other"}
LEVEL_LABEL = {"good": "正常", "caution": "需注意", "severe": "嚴重", "missing": "無人行道"}
GRADE_LABEL = {"A": "良好", "B": "尚可", "C": "待改善", "D": "優先改善"}


# ---------------------------------------------------------------- 評分（純函式，test_integrate.py 測試）
def grade_of(score: float, cuts: dict) -> str:
    if score < cuts["A"]:
        return "A"
    if score < cuts["B"]:
        return "B"
    if score < cuts["C"]:
        return "C"
    return "D"


def score_segment(level: str, confirmed_anomalies: int, m2_detections: int, safety_mean: float | None, w: dict) -> dict:
    comp = {
        "m1": float(w["level_points"][level]),
        "anomalies": min(confirmed_anomalies * w["anomaly_point"], w["anomaly_cap"]),
        "m2": min(m2_detections * w["m2_point"], w["m2_cap"]),
        "safety": 0.0 if safety_mean is None else min(max(5 - safety_mean, 0) / w["safety_divisor"], w["safety_cap"]),
    }
    comp = {k: round(v, 3) for k, v in comp.items()}
    total = round(sum(comp.values()), 3)
    return {"composite_score": total, "grade": grade_of(total, w["grades"]), "components": comp}


# ---------------------------------------------------------------- 路段配對（與 app/src/lib/geo.ts 相同規則）
class Matcher:
    def __init__(self, features: list[dict], center: tuple[float, float]):
        lng0, lat0 = center
        k = math.cos(math.radians(lat0))
        self._proj = lambda x, y, z=None: ((x - lng0) * 111_320 * k, (y - lat0) * 111_320)
        self.segs = [(f["properties"]["seg_id"], f["properties"]["kind"], transform(self._proj, shape(f["geometry"])))
                     for f in features]

    def nearest(self, lat: float, lng: float, max_dist: float) -> str | None:
        p = Point(self._proj(lng, lat))
        best = None  # (id, dist, kind)
        for sid, kind, g in self.segs:
            d = g.distance(p)
            if d > max_dist:
                continue
            if best is None:
                best = (sid, d, kind)
                continue
            if kind == "sidewalk" and best[2] != "sidewalk":
                prefer = d < best[1] + 3
            elif kind != "sidewalk" and best[2] == "sidewalk":
                prefer = d < best[1] - 3
            else:
                prefer = d < best[1]
            if prefer:
                best = (sid, d, kind)
        return best[0] if best else None


def _f(v) -> float | None:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def resolve_seg(row: dict, ids: set[str], matcher: Matcher, radius: float) -> str | None:
    sid = (row.get("seg_id") or row.get("segId") or "").strip()
    if sid:
        return sid if sid in ids else None
    lat, lng = _f(row.get("lat")), _f(row.get("lng") or row.get("lon"))
    return matcher.nearest(lat, lng, radius) if lat is not None and lng is not None else None


def read_csvs(folder: Path) -> list[dict]:
    rows = []
    for p in sorted(folder.glob("*.csv")):
        with p.open(encoding="utf-8-sig", newline="") as fh:
            rows += [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(fh)]
    return rows


# ---------------------------------------------------------------- 主流程
def integrate(site: str, root: Path = ROOT) -> dict:
    w = yaml.safe_load((root / "config.yaml").read_text(encoding="utf-8"))["integration"]
    out_dir = root / "data/outputs"
    sev = json.loads((out_dir / f"{site}_severity.geojson").read_text(encoding="utf-8"))
    feats = sev["features"]
    ids = {f["properties"]["seg_id"] for f in feats}
    matcher = Matcher(feats, tuple(sev["metadata"]["center"]))
    r = w["match_radius_m"]

    m2 = {sid: 0 for sid in ids}
    safety: dict[str, list[float]] = {sid: [] for sid in ids}
    anomalies = {sid: 0 for sid in ids}
    skipped = {"module2": 0, "module3": 0, "feedback": 0}

    for row in read_csvs(root / "data/module2"):
        conf = _f(row.get("confidence"))
        if row.get("label") not in PROBLEMS or conf is None or conf < w["m2_min_confidence"]:
            continue  # 設施偵測或低信心不計分
        sid = resolve_seg(row, ids, matcher, r)
        if sid is None:
            skipped["module2"] += 1
            continue
        m2[sid] += 1

    for row in read_csvs(root / "data/module3"):
        s = _f(row.get("safety"))
        sid = resolve_seg(row, ids, matcher, r)
        if sid is None or s is None or not 1 <= s <= 5:
            skipped["module3"] += 1
            continue
        safety[sid].append(s)

    fb_path = root / "data/backend/feedback.json"
    feedback = json.loads(fb_path.read_text(encoding="utf-8")) if fb_path.exists() else []
    for fb in feedback:
        sid = fb.get("segId")
        if sid not in ids or fb.get("status") == "rejected":
            skipped["feedback"] += fb.get("status") != "rejected"
            continue
        safety[sid].append(float(fb["safety"]))  # 行經感受：未審核也採計
        if fb.get("status") == "confirmed":       # 異狀：只算經審核確認的
            anomalies[sid] += len(fb.get("anomalies") or [])

    out_feats, rows = [], []
    for f in feats:
        p = f["properties"]
        sid = p["seg_id"]
        mean = round(sum(safety[sid]) / len(safety[sid]), 2) if safety[sid] else None
        res = score_segment(p["level"], anomalies[sid], m2[sid], mean, w)
        res["safety_mean"] = mean
        res["counts"] = {"confirmed_anomalies": anomalies[sid], "m2_detections": m2[sid], "ratings": len(safety[sid])}
        out_feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {**p, **res}})
        rows.append({
            "seg_id": sid, "grade": res["grade"], "grade_label": GRADE_LABEL[res["grade"]],
            "composite_score": res["composite_score"], "road_name": p.get("road_name") or "",
            "from": p.get("from") or "", "to": p.get("to") or "", "m1_level": LEVEL_LABEL[p["level"]],
            "m1_points": res["components"]["m1"], "anomaly_points": res["components"]["anomalies"],
            "m2_points": res["components"]["m2"], "safety_points": res["components"]["safety"],
            "confirmed_anomalies": anomalies[sid], "m2_detections": m2[sid], "ratings": len(safety[sid]),
            "safety_mean": "" if mean is None else mean, "width_m": p.get("width_m") or "",
            "net_width_m": p.get("net_width_m") or "", "canopy_overlap_ratio": p.get("canopy_overlap_ratio") or "",
        })

    rows.sort(key=lambda x: (-x["composite_score"], x["seg_id"]))
    for i, row in enumerate(rows, 1):
        row["rank"] = i
    grades = {g: sum(1 for x in rows if x["grade"] == g) for g in "ABCD"}
    meta = {**sev.get("metadata", {}), "integrated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "weights": w, "grade_counts": grades, "skipped": skipped}

    (out_dir / f"{site}_integrated.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "metadata": meta, "features": out_feats}, ensure_ascii=False), encoding="utf-8")
    cols = ["rank", *[k for k in rows[0] if k != "rank"]]
    with (out_dir / f"{site}_priorities.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=cols)
        wr.writeheader()
        wr.writerows(rows)
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", default="taoyuan_hospital")
    args = ap.parse_args()
    meta = integrate(args.id)
    g = meta["grade_counts"]
    print(f"完成：A {g['A']}／B {g['B']}／C {g['C']}／D {g['D']}；略過（無法配對路段）{meta['skipped']}")


if __name__ == "__main__":
    sys.exit(main())
