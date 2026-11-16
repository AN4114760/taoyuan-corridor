"""SAM 3 遮罩後處理：把「鋪面－車道」收斂成路側人行道，並與國土管理署實測人行道比對。

SAM 3 對空拍的 "sidewalk" 信心很低，notebook 改用 "pavement"（所有鋪面）扣掉 road／crosswalk，
結果會連停車場、廣場、操場跑道一起抓進來。這裡用兩條幾何規則過濾：
  1. 只留距車道邊緣 REACH_M 以內的鋪面（人行道貼著車道）
  2. 去掉「寬度 > MAX_WIDTH_M」的大片鋪面（停車場、廣場）：距離轉換找出寬區核心再往外擴
  3. 去掉面積 < MIN_AREA_M2 的碎片

輸入（data/processed/，Colab notebook 輸出）：<id>_mask_{pavement,road,crosswalk,sidewalk}.tif
輸出：
  data/processed/<id>_mask_sidewalk.tif         過濾後人行道（corridor_metrics.py 直接使用）
  data/processed/<id>_mask_sidewalk_sam3raw.tif 原始「鋪面－車道－行穿線」（第一次執行時備份）
  data/outputs/<id>_sam3_eval.json              與國土管理署人行道（_mask_sidewalk_moi.tif）比對的 precision／recall／IoU
  data/outputs/<id>_sam3_preview.jpg            疊圖：藍＝過濾後人行道、紅＝車道、黃框＝國土管理署人行道

用法：.venv/bin/python module1/sam3_postprocess.py [--id taoyuan_hospital] [--reach 8] [--max-width 8]
"""
import argparse
import json
import math
import shutil

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage as ndi

from common import DATA, load_config

MIN_AREA_M2 = 4.0


def read(path):
    with rasterio.open(path) as s:
        return s.read(1) > 0, s.profile


def disk(r_px):
    r = max(1, int(round(r_px)))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--reach", type=float, default=8.0, help="距車道邊緣多少公尺內的鋪面才算人行道")
    ap.add_argument("--max-width", type=float, default=8.0, help="寬於此值（公尺）的鋪面視為停車場／廣場")
    args = ap.parse_args()
    proc = DATA / "processed"

    raw_path = proc / f"{args.id}_mask_sidewalk_sam3raw.tif"
    out_path = proc / f"{args.id}_mask_sidewalk.tif"
    if not raw_path.exists():
        shutil.copy(out_path, raw_path)
    pavement, prof = read(proc / f"{args.id}_mask_pavement.tif")
    road, _ = read(proc / f"{args.id}_mask_road.tif")
    crosswalk, _ = read(proc / f"{args.id}_mask_crosswalk.tif")

    # EPSG:3857 像素 → 地面公尺
    lat = cfg["pilot"]["lat"]
    px = abs(prof["transform"].a) * math.cos(math.radians(lat))

    cand = pavement & ~road & ~crosswalk
    near_road = ndi.distance_transform_edt(~road) * px <= args.reach
    cand &= near_road

    half = ndi.distance_transform_edt(cand) * px          # 到鋪面邊界的距離 ≈ 半寬
    core = half > args.max_width / 2
    wide = ndi.binary_dilation(core, structure=disk(args.max_width / 2 / px)) & cand
    sw = cand & ~wide

    lab, n = ndi.label(sw)
    if n:
        areas = ndi.sum(sw, lab, index=np.arange(1, n + 1)) * px * px
        keep = np.zeros(n + 1, bool)
        keep[1:] = areas >= MIN_AREA_M2
        sw = keep[lab]

    p = prof.copy()
    p.update(count=1, dtype="uint8", compress="deflate", nodata=None)
    with rasterio.open(out_path, "w", **p) as d:
        d.write(sw.astype(np.uint8), 1)

    stats = {"pixel_m": round(px, 3), "reach_m": args.reach, "max_width_m": args.max_width,
             "area_m2": {"raw": round(float((pavement & ~road & ~crosswalk).sum() * px * px)),
                         "near_road": round(float(cand.sum() * px * px)),
                         "filtered": round(float(sw.sum() * px * px))}}

    moi_path = proc / f"{args.id}_mask_sidewalk_moi.tif"
    if moi_path.exists():
        moi, _ = read(moi_path)
        # 國土管理署只涵蓋已建檔的人行道，precision 偏低不一定是誤判；recall 才是主要指標
        for name, m in (("raw", pavement & ~road & ~crosswalk), ("filtered", sw)):
            tp = float((m & moi).sum())
            stats[name] = {"precision": round(tp / max(m.sum(), 1), 3),
                           "recall": round(tp / max(moi.sum(), 1), 3),
                           "iou": round(tp / max((m | moi).sum(), 1), 3)}
        # 容許 1.5m 位移（航照與實測資料的套疊誤差）
        tol = disk(1.5 / px)
        moi_d, sw_d = ndi.binary_dilation(moi, tol), ndi.binary_dilation(sw, tol)
        stats["filtered_tol1.5m"] = {"precision": round(float((sw & moi_d).sum()) / max(sw.sum(), 1), 3),
                                     "recall": round(float((moi & sw_d).sum()) / max(moi.sum(), 1), 3)}

    out_json = DATA / "outputs" / f"{args.id}_sam3_eval.json"
    out_json.write_text(json.dumps(stats, ensure_ascii=False, indent=2))
    print(json.dumps(stats, ensure_ascii=False, indent=2))

    # 預覽：中央 1500px
    with rasterio.open(proc / f"{args.id}_ortho_z19.tif") as s:
        rgb = s.read([1, 2, 3]).transpose(1, 2, 0).astype(float)
    H, W = sw.shape
    r = 750
    win = (slice(H // 2 - r, H // 2 + r), slice(W // 2 - r, W // 2 + r))
    view = rgb[win]
    for m, color, a in ((road[win], [255, 40, 40], 0.35), (sw[win], [30, 120, 255], 0.65)):
        view[m] = view[m] * (1 - a) + np.array(color) * a
    if moi_path.exists():
        edge = moi[win] & ~ndi.binary_erosion(moi[win], iterations=2)
        view[edge] = [255, 220, 0]
    prev = DATA / "outputs" / f"{args.id}_sam3_preview.jpg"
    Image.fromarray(view.clip(0, 255).astype(np.uint8)).save(prev, quality=88)
    print("→", out_path, "\n→", out_json, "\n→", prev)


if __name__ == "__main__":
    main()
