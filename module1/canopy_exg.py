"""樹冠備案：以 ExG（Excess Green）植生指數從 RGB 航照萃取綠色植被遮罩。

SAM 3 權限尚未核准前使用；之後可作為 SAM 3「tree canopy／shrub」結果的交叉比對。
ExG = 2g − r − b，其中 r,g,b 為正規化色度（r = R/(R+G+B)…）。

用法：.venv/bin/python module1/canopy_exg.py [--id taoyuan_hospital] [--threshold 0.05]
輸出：data/processed/<id>_canopy_exg.tif（uint8，1=植被）＋ data/outputs/<id>_canopy_exg_preview.jpg
"""
import argparse

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage

from common import DATA, load_config


def exg_mask(rgb, threshold, min_area_px=40):
    rgb = rgb.astype(np.float32)
    total = rgb.sum(axis=0) + 1e-6
    r, g, b = rgb / total
    exg = 2 * g - r - b
    # 太暗的像素（陰影）色度不穩定，排除
    bright = total > 90
    mask = (exg > threshold) & bright
    # 形態學清理：去小雜點、補小洞
    mask = ndimage.binary_opening(mask, iterations=1)
    mask = ndimage.binary_closing(mask, iterations=2)
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        keep = np.isin(lab, np.where(sizes >= min_area_px)[0] + 1)
        mask = keep
    return mask.astype(np.uint8), exg


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--threshold", type=float, default=cfg["segmentation"]["exg_threshold"])
    args = ap.parse_args()

    src_path = DATA / "processed" / f"{args.id}_ortho_z{cfg['orthophoto']['zoom']}.tif"
    with rasterio.open(src_path) as src:
        rgb = src.read()
        profile = src.profile
    mask, _ = exg_mask(rgb, args.threshold)

    profile.update(count=1, dtype="uint8", compress="deflate", photometric="minisblack", nodata=None)
    profile.pop("jpeg_quality", None)
    out = DATA / "processed" / f"{args.id}_canopy_exg.tif"
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(mask, 1)
    print(f"植被覆蓋比例（整個範圍）：{mask.mean():.1%} → {out}")

    # 預覽：植被以綠色半透明疊在航照上
    img = rgb.transpose(1, 2, 0).astype(np.float32)
    overlay = img.copy()
    overlay[mask == 1] = overlay[mask == 1] * 0.4 + np.array([0, 255, 80]) * 0.6
    prev = Image.fromarray(overlay.clip(0, 255).astype(np.uint8))
    prev.thumbnail((1600, 1600))
    prev.save(DATA / "outputs" / f"{args.id}_canopy_exg_preview.jpg", quality=85)


if __name__ == "__main__":
    main()
