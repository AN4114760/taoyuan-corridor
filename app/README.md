# 地端後台與志工回饋

一台電腦當伺服器，同一個 Wi-Fi 下的手機和電腦都可以連線使用。不需要 Firebase，也不需要申請帳號。

| 網址 | 給誰用 | 內容 |
|---|---|---|
| `/feedback` | 志工（手機） | 選路段 → 填行經感受（安全感、舒適度 1–5）→ 有異狀時拍照（每項最多 3 張）→ 送出，狀態為「待審核」 |
| `/admin` | 研究團隊（電腦，需要 PIN） | **地圖**、**執行情況**、**複查情況**、**志工回饋**、**需改善路段** |

## 第一次使用

需要 Node 22 以上，以及 repo 根目錄的 `.venv`（模組一已經建好，模組四會用到）。

```bash
cd app
npm install
echo "ADMIN_PIN=自己設一組數字" > .env.local     # 後台 PIN；沒設定時，每次啟動會隨機產生並印在畫面上

# （選用）先產生假資料，才有東西可以操作；之後可以一鍵清除
../.venv/bin/python ../scripts/seed_demo.py
```

## 每次啟動

```bash
cd app
npm start
```
啟動後終端機會顯示兩個網址：
- 本機：`http://localhost:8787/admin`
- 手機：`http://<這台電腦的 IP>:8787/feedback`

手機需要和這台電腦連同一個 Wi-Fi。學校或公司的 Wi-Fi 若隔離裝置，可以改用手機熱點。

## 資料放在哪裡

| 資料 | 位置 | 說明 |
|---|---|---|
| 路段、設施 | `data/outputs/taoyuan_hospital_severity.geojson`、`_features.geojson` | 模組一輸出，唯讀 |
| 模組二、三 | `data/module2/*.csv`、`data/module3/*.csv` | 隊友依 `docs/data-contract.md` 交件。放進資料夾後在後台按「重新整理」；格式錯誤的列會列在「執行情況 → 交件檔案」 |
| 志工回饋 | `data/backend/feedback.json` | 照片壓縮後以 base64 存在裡面。每次寫入前會備份到 `data/backend/.bak/`。**不進 git**（含照片與位置） |
| 綜合評級 | `data/outputs/taoyuan_hospital_integrated.geojson`、`_priorities.csv` | 在後台按「重新計算」，或執行 `.venv/bin/python module4/integrate.py` |

- **假資料**：檔名以 `demo-` 開頭，或帶有 `demo: true`，後台會標「示範」。
  - 清除：`.venv/bin/python scripts/seed_demo.py --purge`
  - 執行 seed 時請先停掉伺服器，避免兩邊同時寫入。
- **評分權重**：在根目錄 `config.yaml` 的 `integration` 區段，規則見 `docs/data-contract.md`。
- **異狀與安全感怎麼計分**：
  - 志工回報的異狀：要在「複查情況」按「確認」才計分。
  - 行經感受（安全感）：除了「不成立」的回報以外都採計。

## 開發

```bash
npm run server   # 終端機 1：API（:8787）
npm run dev      # 終端機 2：Vite（熱更新，/api 會自動轉到 :8787）
npm test         # 最近路段配對、CSV 驗證、伺服器 API（含重新計算）
../.venv/bin/python -m unittest ../module4/test_integrate.py   # 模組四評分
```

- **伺服器**：`server.mjs` 只用 Node 內建模組
- **前端**：Vue 3、Pinia、Leaflet（底圖規則和 `module1/map.html` 相同）
- **資料層**：集中在 `src/stores/data.ts`。之後改接 Firebase 時只要換這個檔案，舊的設定檔放在 `_firebase-later/`

## 限制

- **GPS**：手機用 `http://` 開網頁時，瀏覽器不允許定位，志工請直接在地圖上點選路段。拍照不受影響。
- **只在本機運作**：伺服器那台電腦關機後就收不到回報。要讓一般民眾公開使用，需要改接雲端（Firebase）。
- **PIN 不是正式權限**：PIN 只能防止誤觸，不能當作正式的權限控管。不要把伺服器開到公開網路上。
