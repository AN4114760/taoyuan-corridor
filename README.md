# 以衛星及AI影像診斷醫養機構無障礙廊道｜模組一：遙測判釋

從航照與衛星影像判讀桃園市醫院、長照機構周邊的人行道與樹冠，計算**綠蔽交集率**與**人行道斷點**，輸出給 App 地圖使用的 GeoJSON。

## 環境
- 本機：Python 3.9 以上，`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- SAM 3 分割在 **Google Colab（T4 GPU）** 執行（官方建議 NVIDIA GPU ≥16GB 顯存，本機跑不動）
- 系統 Python 3.9 的 LibreSSL 連不上部分 HTTPS 站台，所以網路下載統一走系統 `curl`（`common.curl_get`）

## 帳號（請先申請）
| 帳號 | 用途 | 狀態 |
|---|---|---|
| Hugging Face（[facebook/sam3](https://huggingface.co/facebook/sam3) 存取權） | SAM 3 權重 | 需審核 |
| Google Earth Engine 非商業 Cloud 專案 | Sentinel-2 篩選 | Community 方案免綁卡 |
| TGOS 地址定位金鑰 | 機構地址轉座標 | 放進 `.env`（參考 `.env.example`） |

## 執行步驟（先導：衛福部桃園醫院）
```bash
# 1. 航照（國土測繪中心 WMTS PHOTO2，z19 ≈ 0.27 m/px）
.venv/bin/python module1/fetch_orthophoto.py
# 2. 道路中心線（OSM）
.venv/bin/python module1/fetch_osm_roads.py
# 3a. 樹冠備案（SAM 3 權限下來前）
.venv/bin/python module1/canopy_exg.py
# 3b. SAM 3 分割：把 data/processed/taoyuan_hospital_ortho_z19.tif 上傳到 Google Drive 的 taoyuan-corridor/，
#     在 Colab 開 module1/sam3_segment.ipynb 執行（T4、全程 float32，約 25 分鐘），下載 *_mask_*.tif 回 data/processed/
#     後處理＋與國土管理署人行道比對：
.venv/bin/python module1/sam3_postprocess.py
# 4. 廊道指標
.venv/bin/python module1/corridor_metrics.py                 # SAM 3 人行道＋SAM 3 樹冠
.venv/bin/python module1/corridor_metrics.py --canopy exg    # SAM 3 人行道＋ExG 樹冠
.venv/bin/python module1/corridor_metrics.py --synthetic-sidewalk --canopy exg   # 只測流程（假人行道）
# 5. 預覽
python3 -m http.server 8000   # 開 http://localhost:8000/module1/preview.html?id=taoyuan_hospital
```

全市篩選：
```bash
.venv/bin/python module1/fetch_facilities.py          # → data/processed/facilities_review.csv（需人工校正座標）
.venv/bin/python module1/fetch_facilities.py --build  # → facilities.geojson，上傳 GEE
# GEE Code Editor 執行 module1/gee_screening.js → 下載 CSV 到 data/raw/taoyuan_facility_indices.csv
.venv/bin/python module1/screening_score.py
```

## 實測人行道（不需權限，建議先用）
內政部國土管理署「全國人行道資料」（[data.gov.tw 58791](https://data.gov.tw/dataset/58791)，113 年上半年、2024-06，桃園市 10,195 筆人行道面，含寬度、淨寬、路緣斜坡數）。
已下載到 `data/raw/moi_sidewalk/`。
```bash
.venv/bin/python module1/moi_sidewalk_metrics.py                 # 每筆人行道的綠蔽交集率（樹冠：ExG）
.venv/bin/python module1/moi_sidewalk_metrics.py --canopy sam3   # SAM 3 樹冠（正式版）
```
輸出 `data/outputs/<id>_sidewalk_metrics_moi.geojson/.csv`、`_summary_moi.json`、`_preview_moi.jpg`。

## SAM 3 評估結果（2026-11-16，桃園醫院）
- 提示詞實測（中央小圖）："sidewalk" 最高僅 0.37 分、"footpath" 幾乎抓不到；改用 "pavement"（鋪面）扣掉 "road"／"zebra crossing"；樹冠用 "trees"、灌木草地用 "vegetation" 扣掉 trees
- **樹冠**：分割乾淨、含陰影中的樹（ExG 會漏），採用為正式樹冠來源 → 加權綠蔽交集率 0.201（ExG 為 0.161）
- **人行道**：與國土管理署實測面比對 recall 13–18%、precision 3–13%（`data/outputs/<id>_sam3_eval.json`）。
  SAM 3 的 "road" 把人行道一起歸進車道（pavement 與 road 重疊 70%），樹冠下的人行道從空中也看不到
  → 人行道以國土管理署實測面為主；空拍無法判定的路段交給模組二（車行相機）與模組三（實走）
- Colab 注意事項：SAM 3 會把 numpy 降到 1.26（rasterio 固定 1.4.3、contourpy 1.3.3）；T4 不支援 bfloat16 硬體加速，notebook 改寫 ViT MLP 為 float32；`Sam3Processor` 內建 0.5 門檻需改成參數值

## 嚴重程度地圖（map.html）
導航風格：淡灰 OSM 底圖＋人行道依嚴重程度上色（綠正常／黃需注意／紅嚴重／深灰主要道路無人行道），加上設施圖標。
```bash
.venv/bin/python module1/severity_map.py        # → data/outputs/<id>_severity.geojson（道路線段）
.venv/bin/python module1/fetch_osm_features.py  # → data/outputs/<id>_features.geojson（設施點位，MapFeature 格式）
python3 -m http.server 8000                     # 開 http://localhost:8000/module1/map.html?id=taoyuan_hospital
```
- 設施圖標在 `icons/`（規格見 `icons/README.md`，預覽 `icons/preview.html`）：依 `type` 對應 SVG，機構 48px、設施 38px；圖標顏色只代表類別，不代表廊道評級
- 所有點位預設 `verified: false`，資訊卡顯示「待現勘」；診所圖層預設關閉（研究範圍排除）；設施點位密集時聚合
- OSM 在桃園的無障礙標註很少（桃園醫院周邊僅公車站 15、醫院 1、診所 1、行穿線 1），坡道／導盲磚／有聲號誌／上下車點需由現地調查補入
- 底圖：OpenFreeMap 向量圖磚（OSM 資料、Positron 樣式，免金鑰），經 MapLibre 接入 Leaflet；名稱只顯示中文
  - 保留：醫療院所（永遠最先出現、最上層，z12 起）、地標（學校、大學、車站、公園、郵局、派出所／警察局、消防局、圖書館、體育場、博物館）、路名、地名、醫療院所內大樓名稱（z16 起，來自 `<id>_facility_buildings.geojson`）
  - 不顯示：門牌號、商店餐廳等一般 POI、宗教場所
  - 無頭 Chrome 無法渲染 WebGL，檢查畫面請用一般瀏覽器

## QGIS 手動描繪（驗證用標準答案）
1. 開啟 QGIS，專案座標系設為 **EPSG:3826（TWD97 / TM2）**
2. 拖入 `data/processed/taoyuan_hospital_ortho_z19.tif`（底圖）與 `data/outputs/taoyuan_hospital_sidewalk_metrics_moi.geojson`（參考）
3. 複製 `data/processed/manual_sidewalk_template.geojson` 為 `taoyuan_hospital_manual_sidewalk.geojson`，拖入 QGIS → 切換編輯 → 新增多邊形
4. 每個人行道面填欄位（可在圖層屬性新增）：`name`（道路名）、`width`（m）、`net_width`（m）、`note`
5. 樹冠下看不到的人行道，依前後段寬度推畫，`note` 填「樹冠下推估」
6. 存檔後執行 `.venv/bin/python module1/moi_sidewalk_metrics.py --sidewalk manual`

## 指標定義（corridor_metrics.py）
- 每條道路兩側、每 20m 一個路段單元，每 2m 拉一條垂直取樣線（距中心線 3–15m，碰到其他道路即停止）
- **人行道帶**：看得到人行道的取樣線起訖距離中位數；看不到時借用同側前後路段（補齊樹冠遮住的段落）
- **綠蔽交集率** = 人行道帶內樹冠（＋灌木）比例
- **斷點**：人行道帶內「非人行道、非樹冠」比例高的取樣線 ≥ 30%
- **標記**：`break` > `suspect_obstruction`（交集率 ≥ 0.5；寬度 < 3m 時 `priority=high`）> `normal`；找不到人行道帶為 `no_sidewalk_detected`
- 門檻在 `config.yaml`

## 輸出給 App（data/outputs/<id>_corridor_segments.geojson）
WGS84 LineString（人行道帶中線），屬性：
`facility_id, facility_name, seg_id, road_name, highway, side, length_m, sidewalk_visible_ratio, est_width_m, canopy_overlap_ratio, gap_type, flag, priority, band_borrowed, photo_year, source_version`

## 已知限制
- Sentinel-2（10m）只用於區域篩選，看不到人行道
- 航照年份：桃園醫院周邊為 2024（浮水印 NLSC 2024）；樹冠下的人行道寬度為推估
- 從空中無法區分頭頂樹冠與地面灌木 → 「疑似阻礙」需現地／實走確認
- ExG 會把綠屋頂、球場算成植被（只取人行道帶內的值，影響有限）；陰影中的樹會漏抓
- OSM 雙向分隔道路的中央分隔島側可能被判為斷點，需搭配 SAM 3 的 road 遮罩或人工檢查
- Nominatim 對台灣門牌命中率低，`facilities_review.csv` 必須人工校正或改用 TGOS

## 資料來源與授權
- 正射影像：內政部國土測繪中心（國土測繪圖資服務雲服務條款）
- 道路：© OpenStreetMap contributors（ODbL 1.0）
- 機構：桃園市社會局老人福利機構一覽表、健保署特約醫事機構（政府資料開放授權條款第 1 版）
- Sentinel-2：Contains modified Copernicus Sentinel data；Cloud Score+（CC-BY-4.0）
