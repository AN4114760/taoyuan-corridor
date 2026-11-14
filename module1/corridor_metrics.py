"""廊道指標：沿道路兩側以垂直取樣線（transect）判讀人行道、樹冠，計算綠蔽交集率與斷點。

方法（每條道路、每一側、每 20m 一個路段單元）：
1. 每 2m 拉一條垂直於道路的取樣線，從 side_offset_m[0] 量到 side_offset_m[1]，
   每 0.25m 讀一次人行道遮罩與樹冠遮罩；碰到其他道路就停止（避免把對向車道或中央分隔島算進來）。
2. 有看到人行道的取樣線 → 記錄人行道起訖距離；路段的「人行道帶」= 這些起訖距離的中位數。
   本路段看不到時，借用同一側前後路段的人行道帶（補齊被樹冠遮住的段落）。
3. 在人行道帶內：
   - 綠蔽交集率 = 樹冠像素比例（樹冠下的人行道從空中看不到，但仍屬於人行道帶）
   - 斷點 = 既不是人行道、也不是樹冠的比例高（人行道真的中斷）
4. 標記：break（斷點）> suspect_obstruction（交集率 ≥ 門檻；寬度 < 3m 時 priority=high）> normal；
   完全找不到人行道帶 → no_sidewalk_detected。

用法：
  .venv/bin/python module1/corridor_metrics.py                         # 使用 SAM 3 遮罩（data/processed/<id>_mask_*.tif）
  .venv/bin/python module1/corridor_metrics.py --canopy exg            # 樹冠改用 ExG 備案
  .venv/bin/python module1/corridor_metrics.py --synthetic-sidewalk    # 只用來測試流程：以道路推估的假人行道帶
輸出：data/outputs/<id>_corridor_segments.geojson、<id>_corridor_summary.json、<id>_corridor_preview.jpg
"""
import argparse
import json
from datetime import date

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import substring, transform

from common import DATA, load_config

T_4326_3826 = Transformer.from_crs(4326, 3826, always_xy=True)
T_3826_4326 = Transformer.from_crs(3826, 4326, always_xy=True)
T_3826_3857 = Transformer.from_crs(3826, 3857, always_xy=True)

STEP_ALONG = 2.0     # 取樣線間距（m）
STEP_ACROSS = 0.25   # 取樣線上的取樣間距（m）
MIN_RUN = 0.5        # 至少連續 0.5m 才算看到人行道
ROAD_HALO = 2.5      # 其他道路中心線 ±2.5m 視為車道，取樣線碰到即停止
# 只供 --synthetic-sidewalk 測試：各道路等級的「半路寬」推估（m）
HALF_WIDTH = {"primary": 10, "trunk": 12, "secondary": 8, "tertiary": 6,
              "unclassified": 4, "residential": 4, "living_street": 3}


class Raster:
    """以 EPSG:3826 座標讀取 EPSG:3857 遮罩的值。"""

    def __init__(self, array, transform_3857):
        self.a = array
        self.inv = ~transform_3857
        self.h, self.w = array.shape

    def sample(self, xs, ys):
        mx, my = T_3826_3857.transform(xs, ys)
        cols, rows = self.inv * (np.asarray(mx), np.asarray(my))
        cols = np.floor(cols).astype(int)
        rows = np.floor(rows).astype(int)
        ok = (rows >= 0) & (rows < self.h) & (cols >= 0) & (cols < self.w)
        out = np.full(len(cols), -1, dtype=np.int32)
        out[ok] = self.a[rows[ok], cols[ok]]
        return out


def first_run(mask, min_len):
    """回傳第一段連續 True（允許 ≤ 2 格小缺口）的 (start_idx, end_idx)，找不到回傳 None。"""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return None
    start = prev = idx[0]
    for i in idx[1:]:
        if i - prev > 3:
            if (prev - start + 1) * STEP_ACROSS >= min_len:
                return start, prev
            start = i
        prev = i
    if (prev - start + 1) * STEP_ACROSS >= min_len:
        return start, prev
    return None


def load_mask(path, like_profile=None):
    with rasterio.open(path) as src:
        return src.read(1), src.transform, src.profile


def to_3857_geom(geom_3826):
    return transform(lambda x, y, z=None: T_3826_3857.transform(x, y), geom_3826)


def build_synthetic_sidewalk(roads_3826, shape_hw, transform_3857):
    """測試用：每條道路兩側在「半路寬」到「半路寬 + 2m」之間畫出人行道帶。"""
    polys = []
    for g, props in roads_3826:
        hw = HALF_WIDTH.get(props.get("highway"), 4)
        band = g.buffer(hw + 2, cap_style=2).difference(g.buffer(hw, cap_style=2))  # 兩側各 2m 寬
        polys.append(to_3857_geom(band))
    return rasterize(((p, 1) for p in polys if not p.is_empty), out_shape=shape_hw,
                     transform=transform_3857, fill=0, dtype="uint8")


def main():
    cfg = load_config()
    mc = cfg["metrics"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    ap.add_argument("--name", default=cfg["pilot"]["name"])
    ap.add_argument("--canopy", choices=["sam3", "exg"], default="sam3")
    ap.add_argument("--synthetic-sidewalk", action="store_true")
    args = ap.parse_args()

    proc, outd = DATA / "processed", DATA / "outputs"
    ortho_path = proc / f"{args.id}_ortho_z{cfg['orthophoto']['zoom']}.tif"
    with rasterio.open(ortho_path) as src:
        T3857, H, W = src.transform, src.height, src.width

    # 道路（EPSG:3826）
    gj = json.loads((DATA / "raw" / f"{args.id}_osm_roads.geojson").read_text())
    roads = []
    for f in gj["features"]:
        g = transform(lambda x, y, z=None: T_4326_3826.transform(x, y), shape(f["geometry"]))
        roads.append((g, f["properties"]))
    cx, cy = T_4326_3826.transform(args.lon, args.lat)
    area = Point(cx, cy).buffer(cfg["buffer_m"])

    # 遮罩
    if args.synthetic_sidewalk:
        sw_arr = build_synthetic_sidewalk(roads, (H, W), T3857)
        source = "synthetic-test"
    else:
        sw_arr, _, _ = load_mask(proc / f"{args.id}_mask_sidewalk.tif")
        source = "sam3"
    if args.canopy == "exg":
        cv_arr, _, _ = load_mask(proc / f"{args.id}_canopy_exg.tif")
    else:
        cv_arr, _, _ = load_mask(proc / f"{args.id}_mask_tree_canopy.tif")
        shrub = proc / f"{args.id}_mask_shrub.tif"
        if shrub.exists():
            cv_arr = np.maximum(cv_arr, load_mask(shrub)[0])
    source += f"+canopy_{args.canopy}"
    SW, CV = Raster(sw_arr, T3857), Raster(cv_arr, T3857)

    # 道路標籤圖：用來讓取樣線碰到「其他道路」時停止
    road_lab = rasterize(((to_3857_geom(g.buffer(ROAD_HALO)), i + 1) for i, (g, _) in enumerate(roads)),
                         out_shape=(H, W), transform=T3857, fill=0, dtype="int32")
    RL = Raster(road_lab, T3857)

    d0, d1 = mc["side_offset_m"]
    offsets = np.arange(d0, d1 + 1e-9, STEP_ACROSS)
    seg_len = mc["segment_length_m"]
    features = []

    for ri, (g, props) in enumerate(roads):
        g = g.intersection(area)
        parts = [g] if g.geom_type == "LineString" else list(getattr(g, "geoms", []))
        for part in parts:
            if part.length < 8:
                continue
            n_seg = max(1, int(round(part.length / seg_len)))
            edges = np.linspace(0, part.length, n_seg + 1)
            for side, side_name in ((1, "left"), (-1, "right")):
                segs = []
                for k in range(n_seg):
                    piece = substring(part, edges[k], edges[k + 1])
                    ss = np.arange(edges[k] + STEP_ALONG / 2, edges[k + 1], STEP_ALONG)
                    profiles, runs = [], []
                    for s in ss:
                        p0 = part.interpolate(max(s - 0.5, 0))
                        p1 = part.interpolate(min(s + 0.5, part.length))
                        tx, ty = p1.x - p0.x, p1.y - p0.y
                        norm = np.hypot(tx, ty) or 1.0
                        nx, ny = -ty / norm * side, tx / norm * side
                        p = part.interpolate(s)
                        xs, ys = p.x + nx * offsets, p.y + ny * offsets
                        lab = RL.sample(xs, ys)
                        other = np.flatnonzero((lab > 0) & (lab != ri + 1))
                        stop = other[0] if other.size else len(offsets)
                        sw = SW.sample(xs, ys)[:stop] == 1
                        cv = CV.sample(xs, ys)[:stop] == 1
                        profiles.append((sw, cv))
                        r = first_run(sw, MIN_RUN)
                        runs.append(None if r is None else (offsets[r[0]], offsets[r[1]] + STEP_ACROSS))
                    segs.append({"piece": piece, "profiles": profiles, "runs": runs})

                # 每個路段的人行道帶；看不到時借用前後路段
                bands = []
                for sg in segs:
                    vis = [r for r in sg["runs"] if r]
                    bands.append((float(np.median([r[0] for r in vis])), float(np.median([r[1] for r in vis])))
                                 if len(vis) >= 2 else None)
                filled = list(bands)
                for k in range(len(segs)):
                    if filled[k] is None:
                        for dk in (1, -1, 2, -2):
                            j = k + dk
                            if 0 <= j < len(bands) and bands[j]:
                                filled[k] = bands[j]
                                break

                for k, sg in enumerate(segs):
                    band = filled[k]
                    base = {"facility_id": args.id, "facility_name": args.name,
                            "seg_id": f"{args.id}-{props.get('osm_id')}-{side_name}-{k:03d}",
                            "road_name": props.get("name"), "highway": props.get("highway"),
                            "side": side_name, "length_m": round(sg["piece"].length, 1),
                            "photo_year": cfg["orthophoto"].get("photo_year"), "source_version": source}
                    if band is None:
                        geom = sg["piece"].offset_curve(side * (d0 + 2))
                        features.append({"geometry": geom, "properties": {
                            **base, "sidewalk_visible_ratio": 0.0, "est_width_m": None,
                            "canopy_overlap_ratio": None, "gap_type": "none_detected",
                            "flag": "no_sidewalk_detected", "priority": None, "band_borrowed": False}})
                        continue
                    i0 = int(round((band[0] - d0) / STEP_ACROSS))
                    i1 = int(round((band[1] - d0) / STEP_ACROSS))
                    fs, fc, brk = [], [], 0
                    for sw, cv in sg["profiles"]:
                        bsw, bcv = sw[i0:i1], cv[i0:i1]
                        if bsw.size == 0:   # 取樣線在人行道帶之前就碰到其他道路
                            continue
                        fs.append(bsw.mean())
                        fc.append(bcv.mean())
                        other = ((~bsw) & (~bcv)).mean()
                        if other > 0.6 and bcv.mean() < 0.3:
                            brk += 1
                    if not fs:
                        continue
                    vis_ratio, cov = float(np.mean(fs)), float(np.mean(fc))
                    widths = [r[1] - r[0] for r in sg["runs"] if r]
                    width = float(np.median(widths)) if widths else float(band[1] - band[0])
                    brk_ratio = brk / len(fs)
                    if brk_ratio >= 0.3:
                        gap, flag = "break", "break"
                    elif cov >= mc["overlap_flag"]:
                        gap, flag = "occluded", "suspect_obstruction"
                    else:
                        gap, flag = ("occluded" if cov > 0.2 else "none"), "normal"
                    priority = ("high" if width < mc["narrow_width_m"] else "medium") \
                        if flag == "suspect_obstruction" else None
                    geom = sg["piece"].offset_curve(side * (band[0] + band[1]) / 2)
                    features.append({"geometry": geom, "properties": {
                        **base, "sidewalk_visible_ratio": round(vis_ratio, 3), "est_width_m": round(width, 2),
                        "canopy_overlap_ratio": round(cov, 3), "gap_type": gap, "flag": flag,
                        "priority": priority, "band_borrowed": bands[k] is None}})

    # 輸出 GeoJSON（WGS84）
    out_feats = []
    for f in features:
        g = f["geometry"]
        if g.is_empty:
            continue
        g84 = transform(lambda x, y, z=None: T_3826_4326.transform(x, y), g)
        out_feats.append({"type": "Feature", "geometry": mapping(g84), "properties": f["properties"]})
    out = outd / f"{args.id}_corridor_segments.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": out_feats}, ensure_ascii=False))

    # 摘要（長度加權）
    def L(flag=None):
        return sum(f["properties"]["length_m"] for f in out_feats
                   if flag is None or f["properties"]["flag"] == flag)
    total = L()
    with_band = [f for f in out_feats if f["properties"]["flag"] != "no_sidewalk_detected"]
    lb = sum(f["properties"]["length_m"] for f in with_band) or 1
    summary = {
        "facility": args.name, "date": date.today().isoformat(), "source_version": source,
        "segments": len(out_feats), "total_side_length_m": round(total),
        "sidewalk_detected_ratio": round(lb / total, 3) if total else 0,
        "continuity_ratio": round(1 - L("break") / lb, 3),
        "mean_canopy_overlap": round(sum(f["properties"]["canopy_overlap_ratio"] * f["properties"]["length_m"]
                                         for f in with_band) / lb, 3),
        "suspect_obstruction_segments": sum(f["properties"]["flag"] == "suspect_obstruction" for f in out_feats),
        "suspect_high_priority": sum(f["properties"]["priority"] == "high" for f in out_feats),
        "break_segments": sum(f["properties"]["flag"] == "break" for f in out_feats),
    }
    (outd / f"{args.id}_corridor_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    # 預覽圖：路段依標記上色疊在航照上
    with rasterio.open(ortho_path) as src:
        img = Image.fromarray(src.read().transpose(1, 2, 0))
    draw = ImageDraw.Draw(img)
    colors = {"normal": (40, 160, 255), "suspect_obstruction": (255, 150, 0),
              "break": (230, 30, 30), "no_sidewalk_detected": (150, 150, 150)}
    inv = ~T3857
    for f in features:
        g = f["geometry"]
        if g.is_empty:
            continue
        lines = [g] if g.geom_type == "LineString" else list(g.geoms)
        for ln in lines:
            mx, my = T_3826_3857.transform(*ln.xy)
            pts = [tuple(inv * (x, y)) for x, y in zip(mx, my)]
            w = 9 if f["properties"]["priority"] == "high" else 6
            draw.line(pts, fill=colors[f["properties"]["flag"]], width=w)
    img.thumbnail((2000, 2000))
    img.save(outd / f"{args.id}_corridor_preview.jpg", quality=88)
    print(f"→ {out}")


if __name__ == "__main__":
    main()
