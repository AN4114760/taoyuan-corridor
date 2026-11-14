"""建立桃園市醫院＋老人福利（長照／安養）機構清單並轉成座標。

資料來源（政府資料開放授權條款第 1 版）：
- 桃園市社會局「桃園市老人福利機構一覽表」（data.gov.tw 161008，兩個 CSV 版本取聯集）
- 健保署「健保特約醫事機構」醫學中心／區域醫院／地區醫院（data.gov.tw 39280、39281、39282）

地址轉座標：
- 有 .env 的 TGOS_APP_ID／TGOS_API_KEY 時，請在 geocode_tgos() 補上 TGOS 呼叫（金鑰下來後再接）
- 目前使用 OSM Nominatim（每秒 1 次），台灣門牌命中率有限，結果需人工校正

用法：
  .venv/bin/python module1/fetch_facilities.py            # 下載＋轉座標 → data/processed/facilities_review.csv
  （人工校正 lat/lon 與 entrance 欄位後）
  .venv/bin/python module1/fetch_facilities.py --build    # 由校正後的 CSV 產生 facilities.geojson
"""
import argparse
import csv
import io
import json
import os
import re
import time
import unicodedata
from urllib.parse import quote

from common import DATA, curl_get

ELDER_URLS = [
    "https://opendata.tycg.gov.tw/api/dataset/536bb44b-b9f1-4336-ad26-34b9e25b3a68/resource/3d7e3b4c-8bc5-47c4-85a9-eec70415b189/download",
    "https://opendata.tycg.gov.tw/api/dataset/536bb44b-b9f1-4336-ad26-34b9e25b3a68/resource/84900799-4949-487f-81f6-d89cc122bc45/download",
]
HOSPITAL_URLS = {
    "醫學中心": "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21001-003",
    "區域醫院": "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21002-005",
    "地區醫院": "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21003-003",
}
FIELDS = ["facility_id", "type", "subtype", "name", "address", "beds", "rating",
          "lat", "lon", "geocode_source", "geocode_query", "needs_review", "entrance_lat", "entrance_lon", "note"]


def read_csv(raw: bytes):
    text = raw.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def norm_addr(a):
    a = unicodedata.normalize("NFKC", a or "").replace(" ", "")
    a = re.sub(r"[（(].*?[）)]", "", a)          # 去括號註記
    a = re.split(r"[；;、]", a)[0]                 # 多地址只取第一個
    a = re.sub(r"\d+樓.*$|\d+F.*$", "", a)        # 去樓層
    if not a.startswith("桃園市"):
        a = "桃園市" + a
    return a


TAOYUAN_BBOX = (24.58, 25.15, 120.95, 121.50)  # lat_min, lat_max, lon_min, lon_max


def geocode_by_name(name):
    """以機構名稱查 OSM（醫院多半有 POI）；必須落在桃園市範圍內。"""
    url = ("https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=tw&q=" + quote(name))
    try:
        res = json.loads(curl_get(url, timeout=30))
    except Exception:  # noqa: BLE001
        res = []
    time.sleep(1.1)
    for r in res:
        lat, lon = float(r["lat"]), float(r["lon"])
        if TAOYUAN_BBOX[0] <= lat <= TAOYUAN_BBOX[1] and TAOYUAN_BBOX[2] <= lon <= TAOYUAN_BBOX[3]:
            return lat, lon, "name:" + name
    return None


def geocode_nominatim(addr):
    """依序嘗試完整門牌 → 去號碼的路名；回傳 (lat, lon, query) 或 None。"""
    tries = [addr, re.sub(r"\d+號.*$", "", addr)]
    for q in dict.fromkeys(tries):
        url = ("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=" + quote(q))
        try:
            res = json.loads(curl_get(url, timeout=30))
        except Exception as e:  # noqa: BLE001
            print("  nominatim error", e)
            res = []
        time.sleep(1.1)  # Nominatim 使用政策：每秒最多 1 次
        if res:
            return float(res[0]["lat"]), float(res[0]["lon"]), q
    return None


def geocode_tgos(addr):
    if not (os.getenv("TGOS_APP_ID") and os.getenv("TGOS_API_KEY")):
        return None
    # TODO：取得 TGOS 金鑰後，依其「地址定位服務」API 文件實作，回傳 (lat, lon, addr)
    return None


def collect():
    rows = []
    seen = set()
    for url in ELDER_URLS:
        for r in read_csv(curl_get(url)):
            name = (r.get("機構名稱") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            rows.append({"type": "elderly_care", "subtype": r.get("收容對象", ""), "name": name,
                         "address": r.get("地址", ""), "beds": r.get("立案床數", ""),
                         "rating": r.get("最近1次評鑑成績", "")})
    for level, url in HOSPITAL_URLS.items():
        for r in read_csv(curl_get(url)):
            addr = unicodedata.normalize("NFKC", r.get("地址", ""))
            # 「終止合約或歇業日期」實為合約迄日（多為未來日期），不用來篩選
            if not addr.startswith("桃園市"):
                continue
            rows.append({"type": "hospital", "subtype": level, "name": r.get("醫事機構名稱", "").strip(),
                         "address": addr, "beds": "", "rating": ""})
    for i, r in enumerate(rows, 1):
        r["facility_id"] = f"{'H' if r['type'] == 'hospital' else 'E'}{i:03d}"
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="由 facilities_review.csv 產生 facilities.geojson")
    args = ap.parse_args()
    review = DATA / "processed" / "facilities_review.csv"

    if args.build:
        feats = []
        with open(review, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                lat = r["entrance_lat"] or r["lat"]
                lon = r["entrance_lon"] or r["lon"]
                if not lat:
                    print("  缺座標，略過：", r["name"])
                    continue
                props = {k: r[k] for k in ("facility_id", "type", "subtype", "name", "address", "beds", "rating")}
                feats.append({"type": "Feature", "properties": props,
                              "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]}})
        out = DATA / "processed" / "facilities.geojson"
        out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
        print(f"{len(feats)} 家機構 → {out}")
        return

    try:
        from dotenv import load_dotenv
        load_dotenv(DATA.parent / ".env")
    except ImportError:
        pass
    rows = collect()
    print(f"共 {len(rows)} 家（醫院 {sum(r['type'] == 'hospital' for r in rows)}、"
          f"老人福利機構 {sum(r['type'] == 'elderly_care' for r in rows)}），開始轉座標…")
    for i, r in enumerate(rows, 1):
        addr = norm_addr(r["address"])
        hit, src = geocode_tgos(addr), "tgos"
        if not hit:
            hit, src = geocode_by_name(r["name"]), "nominatim_name"
        if not hit:
            hit, src = geocode_nominatim(addr), "nominatim_addr"
        if hit:
            r["lat"], r["lon"], r["geocode_query"] = f"{hit[0]:.6f}", f"{hit[1]:.6f}", hit[2]
            r["geocode_source"] = src
            # 名稱命中或完整門牌命中 → 抽查即可；只命中路名 → 需人工校正
            r["needs_review"] = "check" if (src in ("tgos", "nominatim_name") or hit[2] == addr) else "yes"
        else:
            r["geocode_source"], r["needs_review"] = "none", "yes"
        print(f"  {i}/{len(rows)} {r['name'][:18]} → {r.get('geocode_source')} {r.get('needs_review')}")
    with open(review, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"→ {review}\n請在 Excel/QGIS 校正 lat/lon（或填 entrance_lat/lon 為大門位置）後執行 --build")


if __name__ == "__main__":
    main()
