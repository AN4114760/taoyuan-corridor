# 模組二、三、四資料對接說明

本文件說明模組二（車行影像＋VLM）、模組三（互動遊戲＋實走）、模組四（整合評估）**從模組一拿到什麼**、**要交回什麼格式**。
所有模組都以 **`seg_id`（路段代碼）** 對應同一個路段。欄位細節見 [map-data-format.md](map-data-format.md)。

先導機構：衛福部桃園醫院（`taoyuan_hospital`），分析範圍為醫院周邊 500m。

## 共用檔案（模組一輸出，已在 repo）

| 檔案 | 用途 |
|---|---|
| `data/outputs/taoyuan_hospital_severity.geojson` | 79 個路段的位置、`seg_id` 與嚴重程度。**所有模組以 `seg_id` 對應路段** |
| `data/outputs/taoyuan_hospital_sidewalk_metrics_moi.csv` | 44 筆人行道的寬度、淨寬、斜坡數、綠蔽交集率 |
| `data/outputs/taoyuan_hospital_features.geojson` | 公車站、醫院、行穿線等設施點位（全部「待現勘」） |
| `module1/map.html` | 嚴重程度地圖，可用來規劃路線、截圖 |
| `data/outputs/*_preview*.jpg` | 航照與判讀結果預覽圖 |

開地圖：
```bash
git clone https://github.com/AN4114760/taoyuan-corridor.git && cd taoyuan-corridor
python3 -m http.server 8000   # 開 http://localhost:8000/module1/map.html?id=taoyuan_hospital
```

### 路段代碼 `seg_id`
- 實測人行道：`taoyuan_hospital-sw000` ～ `taoyuan_hospital-sw043`（44 段）
- 主要道路無人行道：`taoyuan_hospital-ms000` ～ `taoyuan_hospital-ms034`（35 段；分隔島那一側與橫跨路口的不列入）
- 在地圖上點路段，或打開 `severity.geojson` 查屬性 `seg_id`

### 類別代碼（模組二偵測、模組三 issues、App 回報共用）

**問題類別**

| 代碼 | 說明 |
|---|---|
| `tree-obstruction` | 路樹／植栽阻擋 |
| `parked-vehicle` | 機車／汽車佔用 |
| `broken-surface` | 鋪面破損／高低差 |
| `no-ramp` | 缺少或不良的斜坡 |
| `tactile-broken` | 導盲磚中斷／錯誤 |
| `too-narrow` | 通行寬度不足 |
| `no-sidewalk` | 沒有人行道 |
| `pickup-problem` | 無法上下車（復康巴士／無障礙計程車） |
| `other` | 其他 |

**設施類別**（對應 `icons/<代碼>.svg`）

| 代碼 | 說明 |
|---|---|
| `access-ramp` | 無障礙坡道 |
| `tactile-paving` | 導盲磚 |
| `audible-signal` | 有聲號誌 |
| `crosswalk` | 行人穿越道 |
| `bus-stop` | 公車站 |
| `accessible-pickup` | 無障礙上下車點 |
| `accessible-parking` | 身障優先車格 |

### 共通格式規則
- 座標：WGS84 十進位度數，`lat` 緯度、`lng` 經度（手機 GPS 預設就是）
- 時間 `ts`：ISO 8601，含時區，例如 `2026-11-28T10:15:30+08:00`
- 檔案：CSV（UTF-8、第一列為欄位名）或 JSON 陣列
- `seg_id` 不知道可以留空，整合時依座標配對 **25m 內最近的路段**

---

## 模組二：車行影像＋VLM

### 從模組一拿到的
- **優先拍攝路段**：`level` 為 `severe`（嚴重 5 段）、`caution`（需注意 8 段）、`missing`（主要道路無人行道 35 段）
- **要確認的設施**：`features.geojson` 的公車站 15 處、行穿線 1 處（是否存在、有無坡道）
- **VLM 要辨識的類別**：上面的問題類別＋設施類別

### 要交回的資料：`drive_detections`
一列＝一個偵測結果。範本：[templates/module2_drive_detections.csv](templates/module2_drive_detections.csv)

| 欄位 | 必填 | 說明 |
|---|---|---|
| sessionId | ✓ | 一趟行車的代碼，例如 `drive-20261128-01` |
| ts | ✓ | 影格時間 |
| lat、lng | ✓ | 影格位置 |
| heading |  | 行進方向（0–360°，正北為 0） |
| seg_id |  | 路段代碼；留空則自動配對 |
| label | ✓ | 問題或設施類別代碼 |
| confidence | ✓ | 0–1 |
| model | ✓ | 模型名稱，例如 `gemini-2.5-flash` |
| framePath |  | 影格檔名（影像另外打包上傳） |

---

## 模組三：互動遊戲＋實走

### 從模組一拿到的
- **實走路線**：建議從公車站走到桃園醫院門口，經過嚴重與需注意路段。
  重點：醫院門口中華路，兩段都是高優先的疑似阻礙——`taoyuan_hospital-sw009`（龍壽街→桃園醫院，淨寬 1.2m、綠蔽交集率 84%）、`taoyuan_hospital-sw010`（桃園醫院→中山路1496巷，淨寬 1.2m、綠蔽交集率 50%）
- **路段代碼**：遊戲關卡或問卷題目直接對應 `seg_id`，才能和其他模組合併
- **素材**：地圖截圖、航照預覽圖（`data/outputs/*_preview*.jpg`）

### 要交回的資料：`walk_ratings`
一列＝一位受試者對一個路段的評分。範本：[templates/module3_walk_ratings.csv](templates/module3_walk_ratings.csv)

| 欄位 | 必填 | 說明 |
|---|---|---|
| sessionId | ✓ | 一次實走或一場遊戲的代碼 |
| source | ✓ | `game`（互動遊戲）或 `field`（實走） |
| participantGroup | ✓ | `wheelchair`（輪椅）、`elderly`（高齡）、`visually-impaired`（視障）、`general`（一般） |
| seg_id | 二擇一 | 路段代碼 |
| lat、lng | 二擇一 | 評分地點（沒有 seg_id 時必填） |
| safety | ✓ | 安全感 1–5 整數，5 最安全 |
| comfort | ✓ | 舒適度 1–5 整數，5 最舒適 |
| issues |  | 遇到的問題類別，多個用 `;` 隔開 |
| ts | ✓ | 評分時間 |

---

## 模組四：整合評估

### 輸入（全部以 `seg_id` 合併）
- **模組一**：路段 `level`，以及寬度、淨寬、斜坡、綠蔽交集率
- **模組二**：每個路段的問題偵測數。設施偵測，以及 confidence 低於 0.5 的偵測不計分
- **模組三＋志工回饋**：每個路段的安全感平均。志工回饋中被判「不成立」的不採計
- **志工回報的異狀**：只計算在後台「複查情況」按過「確認」的

程式：`module4/integrate.py`。權重在 `config.yaml` 的 `integration` 區段，也可以在後台「需改善路段」按「重新計算」。

### 綜合評分草案（權重可再討論）

| 來源 | 計分 |
|---|---|
| 模組一等級 | 正常 0、需注意 1、嚴重 2、無人行道 2 |
| 志工回報異狀 | 經複查確認的每筆 +1，最多 +3 |
| 模組二偵測 | 每個問題偵測（confidence ≥ 0.5）+0.5，最多 +2 |
| 模組三安全感 | (5 − 平均分) ÷ 2，最多 +2 |

加總後對應等級：

| 等級 | 分數 | 地圖顏色 |
|---|---|---|
| A 良好 | < 1 | 綠 `#2bb24c` |
| B 尚可 | 1–2 | 黃 `#f5c400` |
| C 待改善 | 2–3.5 | 橘 `#f08a24` |
| D 優先改善 | ≥ 3.5 | 紅 `#e5322d` |

規則：A–D 評級用路段線色表示；設施圖標顏色只代表類別，兩者分開呈現（見 `icons/README.md`）。

### 輸出
- 每個路段的綜合分數與 A–D 等級（GeoJSON，沿用 `severity.geojson` 的幾何，另加 `composite_score`、`grade`）
- 改善優先順序清單
- 綜合評級地圖

---

## 交件方式與進度

| 項目 | 狀態 |
|---|---|
| 模組一路段、設施、地圖 | ✅ 已完成（在 repo） |
| 本文件與 CSV 範本 | ✅ |
| 地端後台＋志工回饋頁（`backstage/`，見 `backstage/README.md`） | ✅ 可以使用，目前是假資料 |
| 模組四計算程式 `module4/integrate.py` | ✅ 可以執行，等模組二、三的真實資料 |

**交件方式**：照範本填 CSV，放進 repo 的 `data/module2/`、`data/module3/`（檔名例如 `drive-20261128-01.csv`），commit 後推上 GitHub。後台按「重新整理」就會讀進來，格式錯誤的列會列在「執行情況 → 交件檔案」。檔名不要用 `demo-` 開頭，那是保留給假資料的；
影像請放雲端硬碟，CSV 的 `framePath` 寫相對路徑。欄位有疑問或需要新增類別，請在群組提出，統一更新本文件。
