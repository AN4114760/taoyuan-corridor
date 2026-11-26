"""道路分隔島（中央分隔帶、快慢車道分隔島）範圍。

OSM 把分隔島兩側的車道畫成兩條「反方向的單行道」。兩側名稱不一定相同：
桃園醫院前同一條分隔道路，一側叫中山路、另一側叫中華路，所以配對時不看名稱。
兩條車道中心線之間的區域就是分隔島（含部分車道路面），這裡：
  - 不會有人行道 → severity_map.py 不在這裡畫「無人行道」路段
  - 分隔島上的綠化不是人行道上的樹冠 → moi_sidewalk_metrics.py 計算綠蔽交集率前先扣掉

作法：沿每條單行道每 STEP 公尺取點，找最近的「方向相反」單行道上的對應點；
距離介於 MIN_SEP–MAX_SEP 時，相鄰兩組對應點圍成四邊形，全部聯集即為分隔島範圍（EPSG:3826）。
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

STEP = 4.0      # 取樣間距（m）
MIN_SEP = 3.0   # 兩側車道中心線最小距離（m）；太近視為同一條路的接續
MAX_SEP = 30.0  # 最大距離（m）；超過視為不同道路（避免把兩條平行的單行街配成一對）
ANTI = -0.7     # 方向向量內積 < 此值才算「反方向」（約 135° 以上）


def _direction(line: LineString, d: float) -> tuple[float, float]:
    a = line.interpolate(max(d - 1.0, 0.0))
    b = line.interpolate(min(d + 1.0, line.length))
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def median_zones(roads_fc: dict, to_3826) -> object:
    """roads_fc：fetch_osm_roads.py 輸出的 GeoJSON（WGS84）；to_3826：pyproj Transformer。回傳 shapely 幾何（可能為空）。"""
    ways: dict[str, list[tuple[LineString, int]]] = {}
    for f in roads_fc["features"]:
        p = f["properties"]
        ow = p.get("oneway")
        if ow not in ("yes", "-1", "true", "1") or f["geometry"]["type"] != "LineString":
            continue
        g = transform(lambda x, y, z=None: to_3826.transform(x, y), shape(f["geometry"]))
        ways.setdefault("oneway", []).append((g, -1 if ow == "-1" else 1))

    quads = []
    for group in ways.values():
        if len(group) < 2:
            continue
        for i, (a, sa) in enumerate(group):
            others = [(b, sb) for j, (b, sb) in enumerate(group) if j != i]
            prev = None  # (p, q, 對應的那條 b)
            n = max(2, int(a.length // STEP) + 1)
            for k in range(n):
                d = a.length * k / (n - 1)
                p = a.interpolate(d)
                da = _direction(a, d)
                best = None
                for b, sb in others:
                    t = b.project(p)
                    q = b.interpolate(t)
                    dist = p.distance(q)
                    if not MIN_SEP <= dist <= MAX_SEP:
                        continue
                    db = _direction(b, t)
                    if (da[0] * db[0] + da[1] * db[1]) * sa * sb >= ANTI:
                        continue
                    if best is None or dist < best[2]:
                        best = (q, b, dist)
                if best is None:
                    prev = None
                    continue
                q, b, _ = best
                if prev is not None and prev[2] is b:
                    quad = Polygon([prev[0], p, q, prev[1]])
                    if quad.is_valid and quad.area > 0:
                        quads.append(quad)
                prev = (p, q, b)
    return unary_union(quads).buffer(0.5) if quads else Polygon()
