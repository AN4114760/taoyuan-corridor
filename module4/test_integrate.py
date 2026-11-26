"""評分規則測試：.venv/bin/python -m unittest module4/test_integrate.py"""
import csv
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import yaml  # noqa: E402

from integrate import ROOT, grade_of, integrate, score_segment  # noqa: E402

W = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))["integration"]


class ScoreTest(unittest.TestCase):
    def test_grade_boundaries(self):
        self.assertEqual(grade_of(0.99, W["grades"]), "A")
        self.assertEqual(grade_of(1.0, W["grades"]), "B")
        self.assertEqual(grade_of(2.0, W["grades"]), "C")
        self.assertEqual(grade_of(3.49, W["grades"]), "C")
        self.assertEqual(grade_of(3.5, W["grades"]), "D")

    def test_good_segment_without_data_is_A(self):
        r = score_segment("good", 0, 0, None, W)
        self.assertEqual((r["composite_score"], r["grade"]), (0, "A"))

    def test_caps(self):
        r = score_segment("severe", 10, 10, 1.0, W)
        self.assertEqual(r["components"], {"m1": 2.0, "anomalies": 3.0, "m2": 2.0, "safety": 2.0})
        self.assertEqual(r["composite_score"], 9.0)
        self.assertEqual(r["grade"], "D")

    def test_safety_formula(self):
        self.assertEqual(score_segment("good", 0, 0, 4.0, W)["components"]["safety"], 0.5)
        self.assertEqual(score_segment("good", 0, 0, 5.0, W)["components"]["safety"], 0.0)

    def test_caution_plus_one_anomaly_is_C(self):
        self.assertEqual(score_segment("caution", 1, 0, None, W)["grade"], "C")


class PipelineTest(unittest.TestCase):
    """用暫存資料夾跑完整流程：只有已確認異狀計分、rejected 不採計、模組二設施偵測不計分。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "data/outputs").mkdir(parents=True)
        (self.tmp / "data/module2").mkdir(parents=True)
        (self.tmp / "data/module3").mkdir(parents=True)
        (self.tmp / "backstage/data").mkdir(parents=True)
        shutil.copy(ROOT / "config.yaml", self.tmp / "config.yaml")
        shutil.copy(ROOT / "data/outputs/taoyuan_hospital_severity.geojson", self.tmp / "data/outputs")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _csv(self, path, rows):
        with open(path, "w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)

    def test_pipeline(self):
        sid = "taoyuan_hospital-sw009"
        self._csv(self.tmp / "data/module2/a.csv", [
            {"seg_id": sid, "label": "tree-obstruction", "confidence": "0.8", "lat": "", "lng": ""},
            {"seg_id": sid, "label": "access-ramp", "confidence": "0.9", "lat": "", "lng": ""},
            {"seg_id": sid, "label": "parked-vehicle", "confidence": "0.3", "lat": "", "lng": ""},
        ])
        self._csv(self.tmp / "data/module3/b.csv", [{"seg_id": sid, "safety": "2", "lat": "", "lng": ""}])
        fb = [
            {"segId": sid, "safety": 2, "status": "confirmed", "anomalies": [{"category": "tree-obstruction"}]},
            {"segId": sid, "safety": 2, "status": "new", "anomalies": [{"category": "too-narrow"}]},
            {"segId": sid, "safety": 5, "status": "rejected", "anomalies": [{"category": "other"}]},
        ]
        (self.tmp / "backstage/data/feedback.json").write_text(json.dumps(fb))
        integrate("taoyuan_hospital", self.tmp)
        out = json.loads((self.tmp / "data/outputs/taoyuan_hospital_integrated.geojson").read_text())
        p = next(f["properties"] for f in out["features"] if f["properties"]["seg_id"] == sid)
        self.assertEqual(p["counts"], {"confirmed_anomalies": 1, "m2_detections": 1, "ratings": 3})
        self.assertEqual(p["safety_mean"], 2.0)
        # severe 2 + 異狀 1 + 模組二 0.5 + (5−2)/2=1.5 → 5.0
        self.assertEqual(p["composite_score"], 5.0)
        with open(self.tmp / "data/outputs/taoyuan_hospital_priorities.csv", encoding="utf-8-sig") as fh:
            first = next(csv.DictReader(fh))
        self.assertEqual(first["seg_id"], sid)


if __name__ == "__main__":
    unittest.main()
