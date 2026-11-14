"""模組一共用工具：設定檔、座標換算、路徑。"""
import math
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


UA = "taoyuan-corridor-research/0.1 (academic, non-commercial)"


def curl_get(url, out_path=None, timeout=120, extra=()):
    """以系統 curl 下載（系統 Python 3.9 的 LibreSSL 無法連部分 HTTPS 站台）。"""
    cmd = ["curl", "-sSL", "-m", str(timeout), "-A", UA, *extra, url]
    if out_path:
        cmd[1:1] = ["-o", str(out_path)]
        subprocess.run(cmd, check=True)
        return out_path
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def load_config():
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


# Web Mercator（EPSG:3857）常數
R = 6378137.0
ORIGIN = math.pi * R  # 20037508.34


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_bounds_3857(x, y, z):
    """回傳圖磚 (x, y, z) 在 EPSG:3857 的 (minx, miny, maxx, maxy)。"""
    size = 2 * ORIGIN / (2 ** z)
    minx = -ORIGIN + x * size
    maxy = ORIGIN - y * size
    return minx, maxy - size, minx + size, maxy


def meters_per_degree_lat():
    return 111_320.0


def bbox_around(lon, lat, radius_m):
    """以點為中心、半徑 radius_m 的經緯度方框。"""
    dlat = radius_m / meters_per_degree_lat()
    dlon = radius_m / (meters_per_degree_lat() * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat
