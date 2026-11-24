"""產生「導航風格」嚴重程度地圖的資料：人行道依嚴重程度分四級，並標出主要道路上沒有人行道的路段。

等級（顏色）：
  good    綠  正常
  caution 黃  需注意：綠蔽交集率 ≥ 0.5 但人行道寬 ≥ 3m，或淨寬 1.2–1.5m
  severe  紅  嚴重：綠蔽交集率 ≥ 0.5 且人行道寬 < 3m，或淨寬 < 1.2m
  missing 深灰 主要道路（primary/secondary/tertiary）該側 20m 內沒有實測人行道

輸入：data/outputs/<id>_sidewalk_metrics_moi.geojson（moi_sidewalk_metrics.py 產出）、data/raw/<id>_osm_roads.geojson
輸出：data/outputs/<id>_severity.geojson（WGS84；人行道為 Polygon、缺人行道為 LineString，屬性 seg_id/level/kind/label；格式見 docs/map-data-format.md）

用法：.venv/bin/python module1/severity_map.py [--id taoyuan_hospital]
"""
import argparse
import json

import numpy as np
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape
from shapely.ops import substring, transform, unary_union

from common import DATA, load_config

T_4326_3826 = Transformer.from_crs(4326, 3826, always_xy=True)
T_3826_4326 = Transformer.from_crs(3826, 4326, always_xy=True)
MAJOR = {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link", "tertiary_link"}
SEG = 20.0          # 缺人行道判讀的路段長度（m）
SIDE_REACH = 20.0   # 往道路單側找人行道的距離（m）
MIN_COVER = 0.15    # 單側帶狀區與人行道重疊面積比例低於此值 → 視為沒有人行道


def tf(g, t):
    return transform(lambda x, y, z=None: t.transform(x, y), g)


def level_of(p, cfg):
    ov = p.get("canopy_overlap_ratio") or 0
    width = p.get("width_m")
    net = p.get("net_width_m")
    narrow = width is not None and float(width) < cfg["metrics"]["narrow_width_m"]
    if (ov >= cfg["metrics"]["overlap_flag"] and narrow) or (net is not None and float(net) < 1.2):
        return "severe"
    if ov >= cfg["metrics"]["overlap_flag"] or (net is not None and float(net) < 1.5):
        return "caution"
    return "good"


def reason_of(p, level, cfg):
    out = []
    ov = p.get("canopy_overlap_ratio") or 0
    if ov >= cfg["metrics"]["overlap_flag"]:
        out.append(f"綠蔽交集率 {ov:.0%}")
    net = p.get("net_width_m")
    if net is not None and float(net) < 1.5:
        out.append(f"淨寬 {net} m")
    return "、".join(out) if out else "正常"


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    args = ap.parse_args()

    sw = json.loads((DATA / "outputs" / f"{args.id}_sidewalk_metrics_moi.geojson").read_text())
    roads = json.loads((DATA / "raw" / f"{args.id}_osm_roads.geojson").read_text())
    cx, cy = T_4326_3826.transform(args.lon, args.lat)
    area = Point(cx, cy).buffer(cfg["buffer_m"])

    feats = []
    sw_geoms = []
    for f in sw["features"]:
        p = f["properties"]
        lv = level_of(p, cfg)
        sw_geoms.append(tf(shape(f["geometry"]), T_4326_3826))
        feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "kind": "sidewalk", "level": lv, "label": reason_of(p, lv, cfg),
            "road_name": p.get("road_name"), "from": p.get("from"), "to": p.get("to"),
            "width_m": p.get("width_m"), "net_width_m": p.get("net_width_m"), "ramps": p.get("ramps"),
            "canopy_overlap_ratio": p.get("canopy_overlap_ratio"), "id": p.get("sw_id"), "seg_id": p.get("sw_id")}})
    sw_union = unary_union(sw_geoms).buffer(0.5) if sw_geoms else None

    n_missing = 0
    for rf in roads["features"]:
        rp = rf["properties"]
        if rp.get("highway") not in MAJOR:
            continue
        g = tf(shape(rf["geometry"]), T_4326_3826).intersection(area)
        parts = [g] if g.geom_type == "LineString" else list(getattr(g, "geoms", []))
        for part in parts:
            if part.length < 10:
                continue
            n = max(1, int(round(part.length / SEG)))
            edges = np.linspace(0, part.length, n + 1)
            for k in range(n):
                piece = substring(part, edges[k], edges[k + 1])
                for side, sname in ((1, "left"), (-1, "right")):
                    strip = piece.buffer(side * SIDE_REACH, single_sided=True, cap_style=2)
                    cover = strip.intersection(sw_union).area / (piece.length * 2.0) if sw_union else 0
                    if cover >= MIN_COVER:
                        continue
                    line = piece.offset_curve(side * 6.0)   # 畫在道路該側
                    if line.is_empty:
                        continue
                    n_missing += 1
                    feats.append({"type": "Feature", "geometry": mapping(tf(line, T_3826_4326)), "properties": {
                        "seg_id": f"{args.id}-ms{n_missing - 1:03d}",
                        "kind": "missing", "level": "missing", "label": "主要道路此側無實測人行道",
                        "road_name": rp.get("name"), "side": sname, "highway": rp.get("highway")}})

    out = DATA / "outputs" / f"{args.id}_severity.geojson"
    meta = {"facility": cfg["pilot"]["name"], "center": [args.lon, args.lat], "radius_m": cfg["buffer_m"],
            "photo_year": cfg["orthophoto"].get("photo_year"), "sidewalk_source": "國土管理署 113 上半年"}
    out.write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": feats}, ensure_ascii=False))
    counts = {lv: sum(f["properties"]["level"] == lv for f in feats) for lv in ("good", "caution", "severe", "missing")}
    print(counts, "→", out)


if __name__ == "__main__":
    main()
