"""從 OpenStreetMap 抓機構周邊的設施點位，轉成地圖 MapFeature 格式（對應 icons/ 的 type）。

type 對應（OSM 標籤 → 圖標）：
  hospital            amenity=hospital
  clinic              amenity=clinic|doctors（研究範圍排除診所，地圖預設不顯示）
  care-home           amenity=nursing_home、social_facility=nursing_home|assisted_living、social_facility:for=senior
  bus-stop            highway=bus_stop
  crosswalk           highway=crossing（節點）
  access-ramp         kerb=lowered|flush（路緣斜坡／齊平）
  tactile-paving      tactile_paving=yes
  audible-signal      traffic_signals:sound=yes
  accessible-parking  amenity=parking_space + parking_space=disabled，或 capacity:disabled>0
  accessible-pickup   OSM 無對應標籤 → 由現地調查（模組二、三）新增

所有點位 verified=false（OSM 資料未經本研究現勘）。
用法：.venv/bin/python module1/fetch_osm_features.py [--id taoyuan_hospital]
輸出：data/outputs/<id>_features.geojson
資料授權：© OpenStreetMap contributors, ODbL 1.0
"""
import argparse
import json
import subprocess

from common import DATA, UA, bbox_around, load_config

OVERPASS = "https://overpass-api.de/api/interpreter"


def classify(t):
    if t.get("amenity") == "hospital":
        return "hospital"
    if t.get("amenity") == "nursing_home" or t.get("social_facility") in ("nursing_home", "assisted_living") \
            or t.get("social_facility:for") == "senior":
        return "care-home"
    if t.get("amenity") in ("clinic", "doctors"):
        return "clinic"
    if t.get("highway") == "bus_stop":
        return "bus-stop"
    if t.get("traffic_signals:sound") == "yes":
        return "audible-signal"
    if t.get("amenity") == "parking_space" and (t.get("parking_space") == "disabled"
                                                or (t.get("capacity:disabled") or "0") not in ("0", "no")):
        return "accessible-parking"
    if t.get("kerb") in ("lowered", "flush"):
        return "access-ramp"
    if t.get("tactile_paving") == "yes" and t.get("highway") != "crossing":
        return "tactile-paving"
    if t.get("highway") == "crossing":
        return "crosswalk"
    return None


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=cfg["pilot"]["id"])
    ap.add_argument("--lat", type=float, default=cfg["pilot"]["lat"])
    ap.add_argument("--lon", type=float, default=cfg["pilot"]["lon"])
    ap.add_argument("--radius", type=float, default=cfg["buffer_m"])
    args = ap.parse_args()

    w, s, e, n = bbox_around(args.lon, args.lat, args.radius)
    bb = f"({s},{w},{n},{e})"
    q = f"""[out:json][timeout:90];
(
  nwr["amenity"~"^(hospital|clinic|doctors|nursing_home)$"]{bb};
  nwr["social_facility"~"^(nursing_home|assisted_living)$"]{bb};
  node["highway"~"^(bus_stop|crossing)$"]{bb};
  node["kerb"~"^(lowered|flush)$"]{bb};
  nwr["tactile_paving"="yes"]{bb};
  node["traffic_signals:sound"="yes"]{bb};
  nwr["amenity"="parking_space"]["parking_space"="disabled"]{bb};
  nwr["capacity:disabled"]{bb};
);
out center tags;"""
    res = subprocess.run(["curl", "-sS", "-m", "120", "-A", UA, "--data-urlencode", f"data={q}", OVERPASS],
                         capture_output=True, text=True, check=True)
    feats, counts = [], {}
    for el in json.loads(res.stdout)["elements"]:
        t = el.get("tags", {})
        typ = classify(t)
        if not typ:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        counts[typ] = counts.get(typ, 0) + 1
        props = {
            "id": f"osm-{el['type']}-{el['id']}", "type": typ,
            "name": t.get("name") or t.get("name:zh") or "",
            "address": " ".join(filter(None, [t.get("addr:city"), t.get("addr:district"), t.get("addr:street"),
                                              t.get("addr:housenumber")])) or None,
            "source": "osm", "verified": False,
            "properties": {k: v for k, v in t.items() if k in (
                "wheelchair", "crossing", "crossing:island", "kerb", "tactile_paving", "traffic_signals:sound",
                "route_ref", "shelter", "bench", "healthcare", "operator", "capacity:disabled", "beds")},
        }
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": props})
    out = DATA / "outputs" / f"{args.id}_features.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    print(counts, "→", out)


if __name__ == "__main__":
    main()
