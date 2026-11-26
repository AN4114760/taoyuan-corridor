# 地圖資料格式（模組一輸出）

給模組二、三、四與 App 開發使用。所有檔案都是 **GeoJSON、WGS84（EPSG:4326）**，座標順序為 `[經度, 緯度]`。
檔名中的 `<id>` 是機構代碼，先導機構為 `taoyuan_hospital`（衛福部桃園醫院）。

## 檔案在哪裡

| 用途 | 路徑 | 產生程式 |
|---|---|---|
| 地圖網頁 | `module1/map.html` | 手寫（Leaflet＋MapLibre） |
| 路段嚴重程度（地圖主圖層） | `data/outputs/<id>_severity.geojson` | `module1/severity_map.py` |
| 設施點位（公車站、醫院、行穿線…） | `data/outputs/<id>_features.geojson` | `module1/fetch_osm_features.py` |
| 院內大樓名稱（底圖標籤） | `data/outputs/<id>_facility_buildings.geojson` | `module1/fetch_osm_features.py` |
| 人行道逐筆指標（詳細版） | `data/outputs/<id>_sidewalk_metrics_moi.geojson`／`.csv` | `module1/moi_sidewalk_metrics.py` |
| 先導統計數字 | `data/outputs/<id>_sidewalk_summary_moi.json` | `module1/moi_sidewalk_metrics.py` |
| 設施圖標 SVG | `icons/*.svg`（規格見 `icons/README.md`） | — |
| 靜態預覽圖 | `data/outputs/*_preview*.jpg` | 各程式 |

## 怎麼開地圖

```bash
git clone https://github.com/AN4114760/taoyuan-corridor.git
cd taoyuan-corridor
python3 -m http.server 8000
# 瀏覽器開 http://localhost:8000/module1/map.html?id=taoyuan_hospital
```
- 不需要裝任何 Python 套件，地圖只讀 `data/outputs/` 的 GeoJSON
- 必須用 http 伺服器開，直接雙擊 html 會因瀏覽器安全限制讀不到資料
- 底圖需要網路（OpenFreeMap 向量圖磚）；Safari／Chrome 都可以，需支援 WebGL

## 1. `<id>_severity.geojson`：路段嚴重程度

`metadata`（FeatureCollection 層級）：

| 欄位 | 範例 | 說明 |
|---|---|---|
| facility | 衛福部桃園醫院 | 機構名稱 |
| center | [121.26915, 24.97717] | 分析中心 [經度, 緯度] |
| radius_m | 500 | 分析半徑 |
| photo_year | 2024 | 航照年份 |
| sidewalk_source | 國土管理署 113 上半年 | 人行道資料來源 |

每個 Feature 是一個**路段**，`kind` 有兩種：

**`kind: "sidewalk"`**：國土管理署實測人行道（Polygon），44 筆

| 欄位 | 型別 | 說明 |
|---|---|---|
| seg_id | string | **路段唯一代碼**，例如 `taoyuan_hospital-sw000`。模組二、三的資料用這個欄位對應路段 |
| level | `good`／`caution`／`severe` | 嚴重程度（判定規則見下） |
| label | string | 判定原因，例如「綠蔽交集率 62%、淨寬 1.2 m」，正常為「正常」 |
| road_name | string | 道路名稱 |
| from／to | string | 起訖點（門牌或路口） |
| width_m | number | 人行道寬度（m） |
| net_width_m | number | 淨寬（扣除設施帶，m） |
| ramps | number | 路緣斜坡數 |
| canopy_overlap_ratio | 0–1 | **綠蔽交集率**＝樹冠（SAM 3）∩ 人行道 ÷ 人行道面積。道路分隔島上的綠化不計入 |
| id | string | 同 seg_id（舊欄位，保留相容） |

**`kind: "missing"`**：主要道路該側 20m 內沒有實測人行道（LineString，畫在道路該側 6m），35 筆。
分隔道路（兩條反向單行道）朝分隔島的那一側不會有人行道，不列入；偏移線橫跨其他主要道路（路口）的也不列入。分隔島範圍由 `module1/medians.py` 計算

| 欄位 | 型別 | 說明 |
|---|---|---|
| seg_id | string | 例如 `taoyuan_hospital-ms000` |
| level | `missing` | 固定值 |
| label | string | 「主要道路此側無實測人行道」 |
| road_name | string | 道路名稱 |
| side | `left`／`right` | 相對於 OSM 道路方向的哪一側 |
| highway | string | OSM 道路等級（primary／secondary／tertiary…） |

**嚴重程度判定**（門檻在 `config.yaml`）：

| level | 顏色 | 條件 |
|---|---|---|
| severe 嚴重 | `#e5322d` 紅 | 綠蔽交集率 ≥ 0.5 且寬度 < 3m，或淨寬 < 1.2m |
| caution 需注意 | `#f5c400` 黃 | 綠蔽交集率 ≥ 0.5（寬度 ≥ 3m），或淨寬 1.2–1.5m |
| good 正常 | `#2bb24c` 綠 | 其他 |
| missing 無人行道 | `#555555` 深灰 | 主要道路該側沒有實測人行道 |

地圖畫法：深色外框 `#2b2b2b`（線寬 11）＋上色線（線寬 7），嚴重的畫在最上層。

> 注意：`seg_id` 由程式依資料順序產生。重新執行 `severity_map.py` 時，只要輸入資料沒變，代碼就不變；
> 若國土管理署資料或分析範圍更新，代碼可能改變，屆時會另行通知。

## 2. `<id>_features.geojson`：設施點位

Point，屬性沿用 `icons/README.md` 的 MapFeature：

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | string | 例如 `osm-node-2127114246` |
| type | string | `hospital`、`care-home`、`clinic`、`bus-stop`、`accessible-pickup`、`accessible-parking`、`access-ramp`、`tactile-paving`、`audible-signal`、`crosswalk`，對應 `icons/<type>.svg` |
| name | string | 名稱 |
| address | string／null | 地址 |
| source | `osm`／`field-survey`／`government-data`／`ai-detected` | 資料來源 |
| verified | boolean | 是否經本研究現勘；目前全部為 `false`，地圖顯示「待現勘」 |
| properties | object | 其他屬性（如 `shelter`、`route_ref`、`kerb`、`tactile_paving`） |

規則：圖標顏色只代表設施類別，不代表路段評級；診所不在研究範圍，地圖預設不顯示。

## 3. `<id>_facility_buildings.geojson`：院內大樓名稱

Point，屬性 `name`、`building`、`osm_id`。地圖在 zoom 16 以上以深藍字顯示。

## 給其他模組的對接方式

- **模組二（車行＋VLM）／模組三（遊戲＋實走）**：每筆資料請附上 `lat`、`lng`（WGS84）與時間 `ts`（ISO 8601）。
  能判斷所在路段時一併填 `seg_id`；沒填的話由後台依座標自動配對 25m 內最近的路段
- **問題類別**（模組二偵測、App 回報共用）：
  `tree-obstruction`（路樹／植栽阻擋）、`parked-vehicle`（車輛佔用）、`broken-surface`（鋪面破損）、`no-ramp`（缺斜坡）、
  `tactile-broken`（導盲磚中斷）、`too-narrow`（寬度不足）、`no-sidewalk`（無人行道）、`pickup-problem`（無法上下車）、`other`
- **模組四（整合評估）**：以 `seg_id` 為鍵，合併模組一 `level`、模組二偵測數、模組三安全感評分與 App 回報，產出 A–D 綜合評級
