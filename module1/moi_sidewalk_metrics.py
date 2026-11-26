"""以內政部國土管理署「全國人行道資料」（實測人行道面）計算機構周邊每筆人行道的綠蔽交集率。

資料：data.gov.tw 58791「113年度上半年度全國人行道資料-新北市、台北市、桃園市(TWD97)」
      SIDEWALK_1_202406_TWD97.geojson（EPSG:3826 MultiPolygon）
欄位：NAME 道路名稱、PSTART/PEND 起訖點、SW_DIRECT 方向、SW_LENG 長度(m)、SW_WTH 寬度(m)、
      SWW_WTH 淨寬(m)、SW_RAMP 路緣斜坡數、COUNTY_NA 縣市、VILL_NAME 行政區

因為是實測的人行道面（含樹冠下的部分），綠蔽交集率可直接計算：
  綠蔽交集率 = 樹冠（＋灌木）像素 ∩ 人行道面 ÷ 人行道面像素
道路分隔島（medians.py）上的綠化不算人行道樹冠：計算前先從樹冠遮罩扣掉，
人行道面落在分隔島內的部分（圖資位移）也不列入分母。

用法：
  .venv/bin/python module1/moi_sidewalk_metrics.py                    # 樹冠用 ExG
  .venv/bin/python module1/moi_sidewalk_metrics.py --canopy sam3      # 樹冠用 SAM 3 遮罩
  .venv/bin/python module1/moi_sidewalk_metrics.py --sidewalk manual  # 改用 QGIS 手繪的人行道（data/processed/<id>_manual_sidewalk.geojson）
輸出：
  data/outputs/<id>_sidewalk_metrics.geojson（WGS84，給地圖／App）
  data/outputs/<id>_sidewalk_metrics.csv、<id>_sidewalk_summary.json、<id>_sidewalk_preview.jpg
  data/processed/<id>_mask_sidewalk_<source>.tif（人行道遮罩，可給 corridor_metrics.py 使用）
"""
import argparse
import csv
import json
from datetime import date

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import Transformer
from rasterio.features import geometry_mask, rasterize
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform

from common import DATA, load_config
from medians import median_zones

T_4326_3826 = Transformer.from_crs(4326, 3826, always_xy=True)
T_3826_4326 = Transformer.from_crs(3826, 4326, always_xy=True)
T_3826_3857 = Transformer.from_crs(3826, 3857, always_xy=True)
MOI_PATH = DATA / "raw" / "moi_sidewalk" / "SIDEWALK_1_202406_TWD97.geojson"
NET_WIDTH_MIN = 1.5   # 市區道路及附屬工程設計規範：人行道淨寬一般情況不得小於 1.5m


def tf(geom, t):
    return transform(lambda x, y, z=None: t.transform(x, y), geom)


def load_sidewalks(source, site_id, area):
    feats = []
    if source == "moi":
        gj = json.loads(MOI_PATH.read_text())
        for f in gj["features"]:
            p = f["properties"]
            if p.get("COUNTY_NA") != "桃園市" or not f["geometry"]:
                continue
            g = shape(f["geometry"])
            if g.intersects(area):
                feats.append((g, p))
    else:  # manual：QGIS 手繪（EPSG:3826 或 WGS84 GeoJSON 皆可）
        path = DATA / "processed" / f"{site_id}_manual_sidewalk.geojson"
        gj = json.loads(path.read_text())
        crs = (gj.get("crs") or {}).get("properties", {}).get("name", "")
        for i, f in enumerate(gj["features"]):
            g = shape(f["geometry"])
            if "3826" not in crs:
                g = tf(g, T_4326_3826)
            p = {"NAME": f["properties"].get("name") or f["properties"].get("NAME"), "PSTART": "", "PEND": "",
                 "SW_DIRECT": "", "SW_LENG": None, "SW_WTH": f["properties"].get("width"),
                 "SWW_WTH": f["properties"].get("net_width"), "SW_RAMP": None, "VILL_NAME": ""}
            if g.intersects(area):
                feats.append((g, p))
    return feats


def main():
    cfg = load_config()
    mc = cfg["metrics"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--name", default=cfg["pilot"]["name"])
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    ap.add_argument("--canopy", choices=["exg", "sam3"], default="exg")
    ap.add_argument("--sidewalk", choices=["moi", "manual"], default="moi")
    args = ap.parse_args()

    proc, outd = DATA / "processed", DATA / "outputs"
    ortho = proc / f"{args.id}_ortho_z{cfg['orthophoto']['zoom']}.tif"
    with rasterio.open(ortho) as src:
        T3857, H, W, profile = src.transform, src.height, src.width, src.profile
        rgb = src.read().transpose(1, 2, 0)
    if args.canopy == "exg":
        with rasterio.open(proc / f"{args.id}_canopy_exg.tif") as s:
            canopy = s.read(1).astype(bool)
    else:
        with rasterio.open(proc / f"{args.id}_mask_tree_canopy.tif") as s:
            canopy = s.read(1).astype(bool)
        shrub = proc / f"{args.id}_mask_shrub.tif"
        if shrub.exists():
            with rasterio.open(shrub) as s:
                canopy |= s.read(1).astype(bool)

    # 道路分隔島：OSM 同名反向單行道之間的區域。上面的綠化不是人行道樹冠，先扣掉
    roads = json.loads((DATA / "raw" / f"{args.id}_osm_roads.geojson").read_text())
    median = median_zones(roads, T_4326_3826)
    in_median = np.zeros((H, W), dtype=bool)
    if not median.is_empty:
        in_median = ~geometry_mask([mapping(tf(median, T_3826_3857))], out_shape=(H, W), transform=T3857, all_touched=False)
    removed = int((canopy & in_median).sum())
    canopy &= ~in_median
    print(f"分隔島 {median.area:,.0f} m²；扣除分隔島上的樹冠 {removed / max(int(canopy.sum()) + removed, 1):.1%}")

    cx, cy = T_4326_3826.transform(args.lon, args.lat)
    area = Point(cx, cy).buffer(cfg["buffer_m"])
    sidewalks = load_sidewalks(args.sidewalk, args.id, area)
    print(f"{args.name} 周邊 {cfg['buffer_m']}m：{len(sidewalks)} 筆人行道（來源：{args.sidewalk}）")

    rows, feats, polys_3857 = [], [], []
    for i, (g, p) in enumerate(sidewalks):
        g_clip = g.intersection(area)
        g3857 = tf(g_clip, T_3826_3857)
        polys_3857.append(g3857)
        inside = ~geometry_mask([mapping(g3857)], out_shape=(H, W), transform=T3857, all_touched=False)
        n_all = int(inside.sum())
        median_ratio = float((inside & in_median).sum()) / n_all if n_all else 0.0
        inside &= ~in_median   # 落在分隔島的部分不列入
        n = int(inside.sum())
        overlap = float(canopy[inside].mean()) if n else None
        width = p.get("SW_WTH")
        net = p.get("SWW_WTH")
        flags = []
        if overlap is not None and overlap >= mc["overlap_flag"]:
            flags.append("suspect_obstruction")
        if net is not None and float(net) < NET_WIDTH_MIN:
            flags.append("net_width_below_1.5m")
        priority = None
        if "suspect_obstruction" in flags:
            priority = "high" if (width is not None and float(width) < mc["narrow_width_m"]) else "medium"
        flag = flags[0] if flags else "normal"
        sid = f"{args.id}-sw{i:03d}"
        props = {"sw_id": sid, "facility_id": args.id, "facility_name": args.name,
                 "road_name": p.get("NAME"), "from": p.get("PSTART"), "to": p.get("PEND"),
                 "district": p.get("VILL_NAME"), "length_m": p.get("SW_LENG"),
                 "width_m": width, "net_width_m": net, "ramps": p.get("SW_RAMP"),
                 "area_m2": round(g_clip.area, 1), "canopy_overlap_ratio": None if overlap is None else round(overlap, 3),
                 "median_excluded_ratio": round(median_ratio, 3),
                 "flag": flag, "flags": ",".join(flags), "priority": priority,
                 "sidewalk_source": f"MOI 113H1 (2024-06)" if args.sidewalk == "moi" else "manual (QGIS)",
                 "canopy_source": f"{args.canopy} on NLSC {cfg['orthophoto'].get('photo_year')}"}
        rows.append(props)
        feats.append({"type": "Feature", "geometry": mapping(tf(g_clip, T_3826_4326)), "properties": props})

    # 人行道遮罩（給 corridor_metrics.py 或驗證 SAM 3 用）
    mask = rasterize(((m, 1) for m in polys_3857 if not m.is_empty), out_shape=(H, W), transform=T3857,
                     fill=0, dtype="uint8")
    mprof = profile.copy()
    mprof.update(count=1, dtype="uint8", compress="deflate", photometric="minisblack", nodata=None)
    mprof.pop("jpeg_quality", None)
    with rasterio.open(proc / f"{args.id}_mask_sidewalk_{args.sidewalk}.tif", "w", **mprof) as dst:
        dst.write(mask, 1)

    tag = args.sidewalk
    (outd / f"{args.id}_sidewalk_metrics_{tag}.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    with open(outd / f"{args.id}_sidewalk_metrics_{tag}.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    total_area = sum(r["area_m2"] for r in rows) or 1
    summary = {
        "facility": args.name, "date": date.today().isoformat(),
        "sidewalk_source": rows[0]["sidewalk_source"], "canopy_source": rows[0]["canopy_source"],
        "sidewalk_count": len(rows), "sidewalk_area_m2": round(total_area),
        "area_weighted_canopy_overlap": round(sum((r["canopy_overlap_ratio"] or 0) * r["area_m2"] for r in rows) / total_area, 3),
        "suspect_obstruction": sum(r["flag"] == "suspect_obstruction" for r in rows),
        "suspect_high_priority": sum(r["priority"] == "high" for r in rows),
        "net_width_below_1.5m": sum("net_width_below_1.5m" in r["flags"] for r in rows),
        "zero_ramp_segments": sum(r["ramps"] == 0 for r in rows),
    }
    (outd / f"{args.id}_sidewalk_summary_{tag}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    # 預覽：人行道依標記上色疊在航照上，並畫出 500m 範圍
    img = Image.fromarray(rgb).convert("RGBA")
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    inv = ~T3857
    colors = {"normal": (40, 150, 255, 170), "suspect_obstruction": (255, 140, 0, 200),
              "net_width_below_1.5m": (230, 30, 200, 190)}
    for r, g in zip(rows, polys_3857):
        for poly in (getattr(g, "geoms", None) or [g]):
            if poly.is_empty:
                continue
            pts = [tuple(inv * xy) for xy in poly.exterior.coords]
            d.polygon(pts, fill=colors[r["flag"]], outline=(255, 255, 255, 255))
    ring = tf(area.exterior, T_3826_3857)
    d.line([tuple(inv * xy) for xy in ring.coords], fill=(255, 255, 0, 255), width=6)
    hx, hy = inv * T_3826_3857.transform(cx, cy)
    d.ellipse([hx - 18, hy - 18, hx + 18, hy + 18], fill=(230, 0, 0, 255), outline=(255, 255, 255, 255), width=4)
    out = Image.alpha_composite(img, over).convert("RGB")
    out.thumbnail((2200, 2200))
    out.save(outd / f"{args.id}_sidewalk_preview_{tag}.jpg", quality=88)
    print("→", outd / f"{args.id}_sidewalk_preview_{tag}.jpg")


if __name__ == "__main__":
    main()
