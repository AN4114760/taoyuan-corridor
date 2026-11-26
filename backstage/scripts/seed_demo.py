"""產生後台示範用的假資料（全部標記 demo），讓地圖、執行情況、複查、評級在隊友交件前就能操作。

  .venv/bin/python backstage/scripts/seed_demo.py           # 先清掉舊的假資料再重新產生
  .venv/bin/python backstage/scripts/seed_demo.py --purge   # 只清除假資料

產生：
  data/module2/demo-drive.csv     模組二車行偵測 60 筆
  data/module3/demo-walk.csv      模組三評分 40 筆
  backstage/data/feedback.json    志工回饋 40 筆（demo: true，其中約 15 筆附示範照片）
嚴重或需注意的路段會分到較多問題與較低安全感，讓示範結果有層次；真實資料不受影響。
執行前請先停掉後台伺服器，避免同時寫入 feedback.json。
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
SITE = "taoyuan_hospital"
TZ = timezone(timedelta(hours=8))
M2, M3 = ROOT / "data/module2/demo-drive.csv", ROOT / "data/module3/demo-walk.csv"
FB = ROOT / "backstage/data/feedback.json"

BAD = {"good": 0.0, "caution": 1.0, "severe": 2.0, "missing": 1.5}
PROBLEMS = ["tree-obstruction", "parked-vehicle", "broken-surface", "no-ramp", "tactile-broken", "too-narrow"]
FACILITIES = ["access-ramp", "crosswalk", "bus-stop", "tactile-paving"]
GROUPS = ["wheelchair", "elderly", "visually-impaired", "general"]
NAMES = ["志工 小林", "志工 阿明", "志工 美華", "志工 志偉", "志工 淑芬"]
COMMENTS = {
    "tree-obstruction": "行道樹樹穴占掉大半人行道，輪椅要下到車道才過得去",
    "parked-vehicle": "機車停滿騎樓和人行道，只能走車道",
    "broken-surface": "地磚破損翹起，助行器卡住",
    "no-ramp": "路口沒有斜坡，緣石太高",
    "tactile-broken": "導盲磚中間斷掉，接到電線桿",
    "too-narrow": "人行道太窄，兩個人無法交會",
    "no-sidewalk": "這一側完全沒有人行道",
}
FINE = ["走起來還算順", "路面平整", "有遮蔭，走起來舒服", ""]
COLORS = {"tree-obstruction": (64, 120, 72), "parked-vehicle": (70, 90, 140), "broken-surface": (130, 110, 90),
          "no-ramp": (150, 80, 60), "tactile-broken": (180, 150, 40), "too-narrow": (110, 110, 110),
          "no-sidewalk": (90, 90, 90)}


def demo_photo(category: str, seed: int) -> str:
    rnd = random.Random(seed)
    img = Image.new("RGB", (640, 480), COLORS.get(category, (100, 100, 100)))
    d = ImageDraw.Draw(img)
    for _ in range(25):
        x, y = rnd.randint(0, 640), rnd.randint(0, 480)
        shade = tuple(min(255, c + rnd.randint(-30, 50)) for c in COLORS.get(category, (100, 100, 100)))
        d.rectangle([x, y, x + rnd.randint(20, 120), y + rnd.randint(10, 60)], fill=shade)
    d.rectangle([0, 400, 640, 480], fill=(0, 0, 0))
    d.text((20, 415), f"DEMO PHOTO  {category}", fill=(255, 255, 255), font_size=28)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def point_on(geom, rnd):
    line = geom.exterior if geom.geom_type == "Polygon" else geom
    p = line.interpolate(rnd.random(), normalized=True)
    return round(p.y, 6), round(p.x, 6)


def clamp15(x: float) -> int:
    return max(1, min(5, round(x)))


def load_feedback() -> list:
    return json.loads(FB.read_text(encoding="utf-8")) if FB.exists() else []


def save_feedback(items: list) -> None:
    FB.parent.mkdir(parents=True, exist_ok=True)
    tmp = FB.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, FB)


def purge() -> int:
    for p in (M2, M3):
        p.unlink(missing_ok=True)
    items = load_feedback()
    keep = [x for x in items if not x.get("demo")]
    if FB.exists():
        save_feedback(keep)
    return len(items) - len(keep)


def seed(rnd: random.Random) -> None:
    sev = json.loads((ROOT / f"data/outputs/{SITE}_severity.geojson").read_text(encoding="utf-8"))
    segs = [(f["properties"]["seg_id"], f["properties"]["level"], shape(f["geometry"])) for f in sev["features"]]
    weights = [1 + 2 * BAD[lv] for _, lv, _ in segs]
    pick = lambda: rnd.choices(segs, weights)[0]  # noqa: E731
    must = [s for s in segs if s[0] in (f"{SITE}-sw009", f"{SITE}-sw010")]  # 醫院門口中華路，一定有資料
    t0 = datetime(2026, 11, 22, 9, 0, tzinfo=TZ)
    ts = lambda: (t0 + timedelta(minutes=rnd.randint(0, 60 * 24 * 4))).isoformat()  # noqa: E731

    # 模組二：約一半不填 seg_id，測試座標配對
    rows = []
    for i in range(60):
        sid, lv, g = must[i % 2] if i < 4 else pick()
        lat, lng = point_on(g, rnd)
        problem = rnd.random() < 0.25 + 0.25 * BAD[lv]
        label = ("tree-obstruction" if i < 4 else rnd.choice(PROBLEMS)) if problem else rnd.choice(FACILITIES)
        rows.append({"sessionId": f"drive-demo-0{1 + i // 30}", "ts": ts(), "lat": lat, "lng": lng,
                     "heading": rnd.randint(0, 359), "seg_id": sid if rnd.random() < 0.5 else "", "label": label,
                     "confidence": round(rnd.uniform(0.4, 0.95), 2), "model": "demo-vlm",
                     "framePath": f"drive-demo/{i:06d}.jpg"})
    M2.parent.mkdir(parents=True, exist_ok=True)
    with M2.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["ts"]))

    # 模組三
    rows = []
    for i in range(40):
        sid, lv, g = must[i % 2] if i < 4 else pick()
        safety = clamp15(4.4 - 1.0 * BAD[lv] + rnd.gauss(0, 0.7))
        issues = [rnd.choice(PROBLEMS)] if safety <= 2 else []
        rows.append({"sessionId": f"{'walk' if i % 3 else 'game'}-demo-{i // 8:02d}", "source": "field" if i % 3 else "game",
                     "participantGroup": rnd.choice(GROUPS), "seg_id": sid, "lat": "", "lng": "",
                     "safety": safety, "comfort": clamp15(safety + rnd.gauss(0, 0.6)), "issues": ";".join(issues), "ts": ts()})
    M3.parent.mkdir(parents=True, exist_ok=True)
    with M3.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["ts"]))

    # 志工回饋
    items, photo_left = [], 15
    for i in range(40):
        sid, lv, g = must[i % 2] if i < 4 else pick()
        lat, lng = point_on(g, rnd)
        safety = clamp15(4.3 - 0.9 * BAD[lv] + rnd.gauss(0, 0.8))
        anomalies = []
        if i < 4 or (BAD[lv] > 0 and rnd.random() < 0.7) or rnd.random() < 0.1:
            cat = "tree-obstruction" if i < 4 else ("no-sidewalk" if lv == "missing" else rnd.choice(PROBLEMS))
            photos = []
            if photo_left > 0 and (i < 4 or rnd.random() < 0.6):
                photos = [demo_photo(cat, i * 10 + k) for k in range(rnd.randint(1, 2))]
                photo_left -= 1
            anomalies.append({"category": cat, "note": COMMENTS.get(cat), "photos": photos})
        status = "new" if i % 10 < 6 else "confirmed" if i % 10 < 9 else "rejected"
        created = ts()
        item = {"id": str(uuid.UUID(int=rnd.getrandbits(128))), "createdAt": created, "volunteerName": rnd.choice(NAMES),
                "participantGroup": rnd.choice(GROUPS), "segId": sid, "lat": lat, "lng": lng,
                "safety": safety, "comfort": clamp15(safety + rnd.gauss(0, 0.6)),
                "comment": COMMENTS[anomalies[0]["category"]] if anomalies and anomalies[0]["category"] in COMMENTS
                else (rnd.choice(FINE) if safety >= 4 else ""), "anomalies": anomalies, "status": status, "demo": True}
        if status != "new":
            item["reviewedAt"] = created
            item["reviewNote"] = "示範：現場照片與描述相符" if status == "confirmed" else "示範：照片看不出問題"
        items.append(item)
    save_feedback(load_feedback() + sorted(items, key=lambda x: x["createdAt"]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--purge", action="store_true", help="只清除假資料")
    ap.add_argument("--seed", type=int, default=20261126)
    args = ap.parse_args()
    n = purge()
    print(f"已清除舊的假資料（志工回饋 {n} 筆、demo CSV）")
    if not args.purge:
        seed(random.Random(args.seed))
        print(f"已產生：{M2.relative_to(ROOT)}、{M3.relative_to(ROOT)}、志工回饋 40 筆 → {FB.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
