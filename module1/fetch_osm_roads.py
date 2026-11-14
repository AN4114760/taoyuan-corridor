"""從 OpenStreetMap（Overpass API）抓機構周邊的道路中心線。

用法：.venv/bin/python module1/fetch_osm_roads.py [--id taoyuan_hospital]
輸出：data/raw/<id>_osm_roads.geojson（WGS84 LineString，含 highway/name/oneway/width/lanes 屬性）
資料授權：© OpenStreetMap contributors, ODbL 1.0
"""
import argparse
import json
import subprocess

from common import DATA, bbox_around, load_config

OVERPASS = "https://overpass-api.de/api/interpreter"
# 車行道路（人行道會沿著這些道路判讀）；service/footway/path 不列入
ROAD_TYPES = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|" \
             "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    ap.add_argument("--radius", type=float, default=cfg["buffer_m"])
    args = ap.parse_args()

    w, s, e, n = bbox_around(args.lon, args.lat, args.radius + 100)
    q = f"""[out:json][timeout:60];
way["highway"~"^({ROAD_TYPES})$"]({s},{w},{n},{e});
out geom tags;"""
    # 系統 Python 3.9 的 LibreSSL 無法與 Overpass 完成 TLS 握手，改用系統 curl
    res = subprocess.run(
        ["curl", "-sS", "-m", "120", "-A", cfg["orthophoto"]["user_agent"],
         "--data-urlencode", f"data={q}", OVERPASS],
        capture_output=True, text=True, check=True)
    feats = []
    for el in json.loads(res.stdout)["elements"]:
        coords = [[p["lon"], p["lat"]] for p in el.get("geometry", [])]
        if len(coords) < 2:
            continue
        tags = el.get("tags", {})
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"osm_id": el["id"], **{k: tags.get(k) for k in
                           ("highway", "name", "oneway", "width", "lanes", "sidewalk")}},
        })
    out = DATA / "raw" / f"{args.id}_osm_roads.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    print(f"{len(feats)} 條道路 → {out}")


if __name__ == "__main__":
    main()
