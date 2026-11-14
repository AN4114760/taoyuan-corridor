"""下載國土測繪中心正射影像（WMTS PHOTO2）並拼接成有地理參考的 GeoTIFF。

用法：
  .venv/bin/python module1/fetch_orthophoto.py                       # 先導機構（config.yaml 的 pilot）
  .venv/bin/python module1/fetch_orthophoto.py --lat 24.97 --lon 121.26 --id my_site

輸出：data/processed/<id>_ortho_z<zoom>.tif（EPSG:3857，RGB）
圖資來源：內政部國土測繪中心，依「國土測繪圖資服務雲」服務條款使用並標示來源。
"""
import argparse
import io
import math
import time

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.transform import from_bounds

from common import DATA, bbox_around, load_config, lonlat_to_tile, tile_bounds_3857

TILE = 256


def fetch_tile(session, url, cache_path, delay):
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return Image.open(cache_path).convert("RGB")
    for attempt in range(3):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image"):
                cache_path.write_bytes(r.content)
                time.sleep(delay)
                return Image.open(io.BytesIO(r.content)).convert("RGB")
            print(f"  [{r.status_code}] {url}")
        except requests.RequestException as e:
            print(f"  retry {attempt + 1}: {e}")
        time.sleep(1.5 * (attempt + 1))
    return None


def main():
    cfg = load_config()
    oc = cfg["orthophoto"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--radius", type=float, default=cfg["buffer_m"])
    ap.add_argument("--zoom", type=int, default=oc["zoom"])
    args = ap.parse_args()

    z = args.zoom
    w, s, e, n = bbox_around(args.lon, args.lat, args.radius)
    x0, y0 = (math.floor(v) for v in lonlat_to_tile(w, n, z))
    x1, y1 = (math.floor(v) for v in lonlat_to_tile(e, s, z))
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    print(f"{args.id}: z{z}, tiles x {x0}-{x1}, y {y0}-{y1} → {nx}×{ny} = {nx * ny} 張")

    cache = DATA / "tiles" / oc["layer"] / str(z)
    cache.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = oc["user_agent"]

    mosaic = np.zeros((ny * TILE, nx * TILE, 3), dtype=np.uint8)
    missing = 0
    for j, ty in enumerate(range(y0, y1 + 1)):
        for i, tx in enumerate(range(x0, x1 + 1)):
            url = oc["url"].format(layer=oc["layer"], z=z, x=tx, y=ty)
            img = fetch_tile(session, url, cache / f"{tx}_{ty}.jpg", oc["delay_s"])
            if img is None:
                missing += 1
                continue
            mosaic[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE] = np.asarray(img)
        print(f"  row {j + 1}/{ny}")

    minx, _, _, maxy = tile_bounds_3857(x0, y0, z)
    _, miny, maxx, _ = tile_bounds_3857(x1, y1, z)
    out = DATA / "processed" / f"{args.id}_ortho_z{z}.tif"
    out.parent.mkdir(parents=True, exist_ok=True)
    transform = from_bounds(minx, miny, maxx, maxy, mosaic.shape[1], mosaic.shape[0])
    with rasterio.open(
        out, "w", driver="GTiff", width=mosaic.shape[1], height=mosaic.shape[0], count=3,
        dtype="uint8", crs="EPSG:3857", transform=transform, compress="jpeg", photometric="ycbcr",
        tiled=True,
    ) as dst:
        dst.write(mosaic.transpose(2, 0, 1))
        dst.update_tags(source="NLSC WMTS " + oc["layer"], zoom=str(z),
                        photo_year=str(oc.get("photo_year")), center=f"{args.lat},{args.lon}")
    px = (maxx - minx) / mosaic.shape[1]
    print(f"完成：{out}（{mosaic.shape[1]}×{mosaic.shape[0]} px，{px:.3f} m/px（Web Mercator），缺圖 {missing} 張）")

    # 另存一張縮圖方便預覽
    prev = Image.fromarray(mosaic)
    prev.thumbnail((1600, 1600))
    prev.save(DATA / "outputs" / f"{args.id}_ortho_preview.jpg", quality=85)


if __name__ == "__main__":
    main()
