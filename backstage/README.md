# 後台說明（backstage）

「以衛星及AI影像診斷醫養機構無障礙廊道」的地端後台。先導機構是衛福部桃園醫院，範圍為醫院周邊 500m，共 79 個路段（人行道 44、主要道路無人行道 35）。
這套後台把四個模組的資料串在一起：

```
模組一 遙測判釋（路段嚴重程度） ─┐
模組二 車行影像＋VLM（CSV）     ─┤
模組三 遊戲／實走評分（CSV）    ─┼─▶ 後台：地圖・執行情況・複查・志工回饋 ─▶ 模組四 A–D 綜合評級 ─▶ 需改善路段清單
志工回饋（手機拍照＋行經感受） ─┘
```

所有東西都在一台電腦上執行，不需要雲端帳號。這台電腦就是伺服器，同一個 Wi-Fi 下的手機和電腦都可以連線使用。

---

## 1. 快速開始

### 第一次使用
需要 Node 22 以上，以及 repo 根目錄的 Python 環境 `.venv`（模組一已經建好）。

```bash
cd backstage
npm install
echo "ADMIN_PIN=請自訂一組數字" > .env.local      # 後台登入 PIN（格式一定要是 ADMIN_PIN=...）

# 選用：先產生假資料，才有東西可以操作
../.venv/bin/python scripts/seed_demo.py
```

### 讓手機可以定位（建議，只要做一次）
手機瀏覽器只在 https 下允許定位。產生自簽憑證後，伺服器會另外開 https：
```bash
npm run cert        # Windows 請在 Git Bash 執行；換了 Wi-Fi（IP 變了）要重新產生
```

### 每次啟動
```bash
cd backstage
npm start
```
終端機會顯示：
```
後台伺服器已啟動（Ctrl+C 停止）
  本機：http://localhost:8787/admin
  手機（同一個 Wi-Fi，可定位）：https://192.168.x.x:8443/
```
- 研究團隊用電腦開「本機」網址，輸入 PIN 進入後台。
- 志工、錄影人員用手機開「手機」網址；可以把這個網址做成 QR code，印出來帶到現場。
- 第一次開 https 網址，手機會警告「連線不安全」（自簽憑證），按「進階 → 繼續前往」即可。
- 沒有執行 `npm run cert` 時只有 http（`http://192.168.x.x:8787/`），可以登入、看紀錄，但**不能定位，所以不能開始走訪**。

---

## 2. 民眾端 App（手機）

### 帳號與身分
1. 第一次使用按「註冊」：手機號碼、密碼（至少 6 字）、稱呼、身分類別（輪椅使用者／高齡者／視障者／一般民眾）。
2. 註冊後帳號是「**待開通**」，只看得到等待畫面。研究團隊在後台「帳號」分頁設定身分後才能使用：

   | 身分 | 底部分頁 |
   |---|---|
   | 1 志工 | 地圖・紀錄・我的 |
   | 2 錄影人員 | 上傳・紀錄・我的 |
   | 3 志工＋錄影 | 地圖・上傳・紀錄・我的 |

3. 登入後 30 天內不用重新登入。忘記密碼由研究團隊在後台重設。
4. 建議「加到主畫面」（Safari 分享鈕／Chrome 選單 → 加到主畫面），之後會像 App 一樣全螢幕開啟。

### 地圖（志工）
1. 全螢幕地圖，藍點是目前位置。右上角 ☰ 是「建議優先走訪」（嚴重／需注意路段，由近到遠），◎ 回到目前位置。
2. 點一段路，下方滑出資訊卡：路名、起訖、判定原因、寬度，以及**你和這段路的距離**。
3. **在路段 50m 內才能按「開始走這段」**；太遠時可以按「導航前往」（開 Google Maps 步行導航）。
4. 開始後走完這段路，填寫：
   - 行經感受：安全感、舒適度各 1–5 分（5 最好）、文字感受（選填）；這次以什麼身分走（預設帳號的身分類別）
   - 有異狀嗎（選填）：選類別，拍 1–3 張照片，加說明；同一段路可以新增多項異狀
5. 送出後狀態為「待審核」，研究團隊在後台複查。走到一半重新整理頁面不會遺失進度；也可以「放棄這次走訪」。

- 開始時的位置、距離、定位精度會跟著回饋一起存下來，後台可以查。伺服器也會再檢查一次距離是否在 50m 內。
- 照片會在手機上先壓縮到約 150–250KB，再上傳。

### 上傳（錄影人員）
選擇影片（可多選），每支可以填備註，依序上傳，有進度條、可取消；上傳中關閉頁面會先提醒。單檔上限 4GB。
影片檔存在 Firebase Storage，上傳紀錄存在地端伺服器並跟著帳號。設定方式見「7. 錄影上傳的 Firebase 設定」。

### 紀錄
- **走訪回饋**：每一筆的審核狀態（待審核／已確認／不成立）與研究團隊備註，點進去看答案與照片。
- **影片**：每支影片的處理狀態與研究團隊備註，可以直接播放。
- 紀錄跟著帳號，換手機登入一樣看得到。

### 我的
帳號資料、身分（只能看，由後台設定）、修改稱呼與身分類別、登出。

**異狀類別**：路樹／植栽阻擋、機車／汽車佔用、鋪面破損／高低差、缺少或不良的斜坡、導盲磚中斷／錯誤、通行寬度不足、沒有人行道、無法上下車（復康巴士／計程車）、其他。

---

## 3. 後台 `/admin`（電腦）

上方有七個分頁。右上角「重新整理」會重新讀取所有資料。如果畫面上出現「含示範資料」，代表目前混有假資料。

### 地圖
- 路段顏色可以切換兩種：
  - **模組一等級**：紅＝嚴重、黃＝需注意、綠＝正常、深灰＝無人行道
  - **A–D 綜合評級**：紅 D 優先改善、橘 C 待改善、黃 B 尚可、綠 A 良好
- 點位圖層可以從右上角的圖層鈕開關：
  - 志工回饋：藍＝待審核、深紅＝已確認、灰＝不成立
  - 模組二偵測：深紫＝問題、淺紫＝設施
- 點一個路段，左下角會顯示：
  - 寬度、淨寬、斜坡數、綠蔽交集率
  - 各模組的資料筆數、安全感平均
  - 綜合分數由哪幾項組成
  - 「看這段的志工回饋」連結

### 執行情況
各模組做到哪裡。進度用「已有資料的路段數／79」表示。

| 卡片 | 看什麼 |
|---|---|
| 模組一 | 79 段已完成，以及嚴重／需注意／正常／無人行道各幾段 |
| 模組二 | 拍到幾段、偵測筆數（問題或設施）、行車趟數、常見類別 |
| 模組三＋志工 | 評分涵蓋幾段、遊戲與實走筆數、志工回饋筆數、各身分人數 |
| 複查 | 有異狀的回饋中，審核了幾筆、還有幾筆待審核 |

另外兩個清單：
- **高優先但還沒有資料**：模組一判為嚴重或需注意，但還沒有人拍過、走過的路段，排下一次出隊時先看這裡。
- **交件檔案**：`data/module2/`、`data/module3/` 裡每個 CSV 的有效筆數。格式錯誤的列會逐列列出原因，而且不會計入。

### 複查情況
審核志工回報的異狀。
1. 上方可以篩選狀態（待審核／已確認／不成立／全部）和類別；預設只顯示有異狀的回饋。
2. 每張卡片會顯示路段、志工、身分、時間、行經感受、異狀類別和照片。點照片可以放大。
3. 填審核備註，例如「現場確認樹穴占 2/3 寬度」，再按 **✓ 確認** 或 **✗ 不成立**。判錯了可以按「改回待審」。

審核結果的影響：
- **確認**：這筆的異狀會計入綜合評級，每項 +1 分。
- **不成立**：整筆不採計，連同行經感受也不算。
- **待審核**：異狀不計分，但行經感受（安全感）會採計。

審核完記得到「需改善路段」按「重新計算」。

### 志工回饋
依路段彙整行經感受，資料來源是志工回饋（不成立的除外）和模組三的評分。
- 每段顯示：筆數、安全感與舒適度平均、各身分的安全感，以及最近的文字感受。
- 分數顏色：紅 < 2.5、橘 < 3.5、綠 ≥ 3.5。
- 預設依「安全感低的優先」排序，可以改成「回饋多的優先」。
- 點一列可以展開每一筆紀錄。

### 需改善路段
模組四的綜合評級，依分數由高到低排列。
- 預設只顯示 C、D，可以切換成 B–D 或全部。
- 「分數組成」橫條顯示分數是由哪幾項加起來的：模組一、已確認異狀、模組二、安全感。
- **重新計算**：執行 `module4/integrate.py`，幾秒內完成。如果計算之後又有人審核，畫面會出現紅字提醒。
- **匯出 CSV**：輸出優先改善清單（UTF-8，Excel 可以直接開），可以附在報告裡或交給主管機關。
- 點「地圖」會跳到該路段的位置。

### 影片
錄影人員上傳的影片（檔案在 Firebase，紀錄在地端伺服器）。
- 可以依處理狀態篩選、搜尋檔名／上傳者／備註、匯出 CSV（含下載網址，可以交給模組二）。
- 點一列可以播放、下載原檔，更新處理狀態（等待處理／處理中／已處理／無法使用）和備註；錄影人員在 App「紀錄」看得到。

### 帳號
App 註冊的帳號，待開通的排最前面（分頁上的數字是待開通人數）。
- **帳號權限**下拉選單：0 待開通、1 志工、2 錄影人員、3 志工＋錄影。改完立即生效，對方在 App 按「重新確認」或重新開啟即可。
- **重設密碼**：志工忘記密碼時，設定新密碼再告訴對方。
- 也看得到每個帳號的身分類別、註冊時間、回饋數、影片數。

---

## 4. 綜合評分規則

權重在根目錄 `config.yaml` 的 `integration` 區段，改完按「重新計算」就會生效。

| 來源 | 計分 | 上限 |
|---|---|---|
| 模組一等級 | 正常 0、需注意 1、嚴重 2、無人行道 2 | 2 |
| 志工回報異狀 | 經複查**確認**的每一項 +1 | 3 |
| 模組二偵測 | 每筆問題偵測（confidence ≥ 0.5）+0.5；設施偵測不計分 | 2 |
| 安全感 | (5 − 平均) ÷ 2；平均包含模組三和志工回饋 | 2 |

加總後的等級：**A** < 1、**B** 1–2、**C** 2–3.5、**D** ≥ 3.5。

例（示範資料）：醫院門口中華路 sw009，模組一判為嚴重（2 分），有 2 筆模組二問題偵測（1 分），安全感平均 2.4（(5−2.4)÷2＝1.3 分），合計 4.3 → D。

模組二、三的資料沒有填 `seg_id` 時，會自動配對到 25m 內最近的路段，實測人行道優先。

---

## 5. 隊友怎麼交資料

| 模組 | 放哪裡 | 格式 |
|---|---|---|
| 模組二 | `data/module2/*.csv` | `docs/templates/module2_drive_detections.csv` |
| 模組三 | `data/module3/*.csv` | `docs/templates/module3_walk_ratings.csv` |

完整欄位見 [docs/data-contract.md](../docs/data-contract.md)。

交件流程：
1. 把檔案放進資料夾，commit 並 push。
2. 伺服器那台電腦 `git pull`。
3. 在後台按「重新整理」。
4. 到「執行情況 → 交件檔案」確認沒有錯誤列。
5. 到「需改善路段」按「重新計算」。

檔名不要用 `demo-` 開頭，那是保留給假資料的。

---

## 6. 資料存放位置

| 資料 | 位置 | 進 git？ |
|---|---|---|
| 路段、設施（模組一） | `data/outputs/taoyuan_hospital_severity.geojson`、`_features.geojson` | ✅ |
| 模組二、三 CSV | `data/module2/`、`data/module3/` | ✅ |
| **志工回饋（含照片）** | `backstage/data/feedback.json` | ❌ 含照片與位置，只留在伺服器電腦 |
| 志工回饋備份 | `backstage/data/.bak/`，每次寫入前自動備份 | ❌ |
| 綜合評級 | `data/outputs/taoyuan_hospital_integrated.geojson`、`_priorities.csv` | ❌ 隨時可以重新計算 |
| 後台 PIN、Firebase 設定 | `backstage/.env.local` | ❌ |
| https 自簽憑證 | `backstage/.cert/` | ❌ |
| **App 帳號** | `backstage/data/users.json`（密碼只存雜湊） | ❌ 含手機號碼，只留在伺服器電腦 |
| 錄影上傳紀錄 | `backstage/data/videos.json` | ❌ |
| **影片檔** | Firebase Storage `videos/{uid}/{id}/` | ❌ 雲端 |
| 登入簽章金鑰 | `backstage/data/.session-secret`（第一次啟動自動產生；刪掉會讓所有人重新登入） | ❌ |

`backstage/data/` 要定期備份到隨身碟或雲端硬碟，因為它只存在伺服器那台電腦上。

### 假資料
```bash
.venv/bin/python backstage/scripts/seed_demo.py           # 產生（會先清掉舊的假資料）
.venv/bin/python backstage/scripts/seed_demo.py --purge   # 只清除
```
- 假資料包括：志工回饋 40 筆、模組二 60 筆、模組三 40 筆，全部標為「示範」。真實資料不受影響。
- 執行前請先停掉伺服器（Ctrl+C）。
- 正式展示或寫報告前，記得清除假資料，再重新計算。

---

## 7. 錄影上傳的 Firebase 設定

影片太大，不適合放在地端伺服器，所以**只有影片檔**放 Firebase Storage；帳號、上傳紀錄、處理狀態都在地端伺服器。沒設定時上傳頁會顯示「尚未設定」，其他功能照常。

1. [Firebase Console](https://console.firebase.google.com) 建立專案。
2. **Authentication** → 登入方式：啟用「匿名」（App 上傳時用來通過 Storage 規則，使用者看不到）。
3. **Storage** → 建立 bucket。新專案要升級 **Blaze 方案**（需綁卡）；免費額度用完後依用量計費，影片很佔空間，建議在 Google Cloud 設定預算提醒。
4. 專案設定 → 一般 → 新增「網頁應用程式」，把設定值填進 `backstage/.env.local`（欄位見 `.env.example` 的 `VITE_FIREBASE_*`），然後重新 `npm start`。
5. 部署 Storage 存取規則（`backstage/firebase/storage.rules`）：
   ```bash
   cd backstage/firebase
   npx firebase-tools login
   npx firebase-tools deploy --only storage --project <專案 ID>
   ```

存取規則摘要：只能上傳影片（video/*、< 4GB）到自己的資料夾，只能讀自己上傳的檔案；其他一律拒絕。
後台播放用的是上傳時取得的下載網址（登記在地端伺服器、後台要 PIN 才看得到），所以不需要另外登入 Firebase。

---

## 8. 常見問題

| 狀況 | 處理方式 |
|---|---|
| 後台 PIN 一直不對 | `.env.local` 的格式必須是 `ADMIN_PIN=數字`（不能只寫數字），改完要重新 `npm start` |
| 手機打不開網址 | 確認手機和電腦連同一個 Wi-Fi；學校或公司的 Wi-Fi 常會隔離裝置，可以改用手機熱點；Mac 的防火牆要允許 node 連入 |
| 地圖沒有藍點、不能「開始走這段」 | 用 http 連線時瀏覽器不允許定位：執行 `npm run cert` 後改開 `https://<IP>:8443/`；手機設定也要允許瀏覽器使用位置 |
| 「開始走這段」按不下去 | 要在路段 50m 內；GPS 在大樓旁誤差較大，可以走到空曠處或稍等定位變準 |
| 註冊後一直顯示「等待開通」 | 請研究團隊在後台「帳號」分頁設定身分，再按「重新確認」 |
| https 網址打不開 | 換了 Wi-Fi 之後 IP 變了，重新執行 `npm run cert` 再 `npm start` |
| 上傳頁顯示「沒有上傳權限」 | Firebase 規則還沒部署，或 Authentication 沒啟用「匿名」（第 7 節） |
| 送出時顯示「25m 內沒有路段」 | 點的位置離路段太遠，請點在有顏色的線上 |
| 地圖底圖是灰色的一般地圖 | 這台裝置不支援 WebGL，會自動改用 OpenStreetMap 底圖，功能不受影響 |
| 「重新計算」失敗 | 確認根目錄有 `.venv`（`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`；Windows 是 `python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`） |
| 隊友的 CSV 沒有出現 | 確認放對資料夾、副檔名是 `.csv`、第一列是欄位名稱，然後按「重新整理」 |

---

## 9. 限制

- 這是**地端版**：伺服器那台電腦關機就收不到回饋，也不適合讓一般民眾公開使用。（錄影上傳走 Firebase，不受伺服器開關影響。）
- 帳號只有手機號碼＋密碼，沒有簡訊驗證；忘記密碼要找研究團隊重設。
- PIN 只能防止誤觸，**不是正式的權限機制**；不要把伺服器開到公開網路上。
- 要公開上線時，可以改接 Firebase。之前寫好的設定放在 [`_firebase-later/`](_firebase-later/)，只需要換掉資料層 `src/stores/data.ts`，畫面和資料格式都不用改。

---

## 10. 開發者

```
backstage/
├── server.mjs              地端伺服器（只用 Node 內建模組）：API＋提供 build 後的網頁；有 .cert/ 時另開 https
├── src/
│   ├── views/auth/         App 登入、註冊
│   ├── views/app/          App：AppShell（底部分頁）、MapTab、WalkView、UploadTab、RecordsTab、FeedbackDetail、MeTab
│   ├── views/admin/        後台七個分頁（MapView、Progress、Review、Voices、Priorities、Videos、Accounts）＋AdminLayout
│   ├── stores/auth.ts、walk.ts   App 帳號、目前走訪中的路段
│   ├── components/CorridorMap.vue   共用地圖（底圖規則與 module1/map.html 相同）
│   ├── stores/data.ts      資料層（之後改接 Firebase 只需要換這個檔案）
│   └── lib/                geo（最近路段）、importer（CSV 驗證）、image（照片壓縮）、api、
│                           geolocation（持續定位、導航連結）、firebase／videos（影片上傳到 Storage）
├── firebase/               影片上傳用的 Storage 規則（firebase deploy）
├── public/                 加到主畫面用的 manifest 與圖示
├── scripts/seed_demo.py    假資料
├── scripts/make_cert.mjs   https 自簽憑證（npm run cert）
├── tests/unit/             最近路段、CSV 驗證、伺服器 API
├── data/                   志工回饋（不進 git）
└── _firebase-later/        之後整套改接 Firebase 用
```

```bash
npm run server   # 終端機 1：API（:8787）
npm run dev      # 終端機 2：Vite 熱更新（/api 會轉到 :8787）
npm test         # 前端與 API 測試
../.venv/bin/python -m unittest ../module4/test_integrate.py   # 模組四評分測試
```

### API
| 方法 | 路徑 | 需要 PIN | 說明 |
|---|---|---|---|
| GET | `/api/segments`、`/api/features` | | 模組一路段、設施 |
| GET | `/api/module/2`、`/api/module/3` | | 交件 CSV 原文（前端驗證） |
| POST | `/api/auth/register`、`/api/auth/login` | | App 註冊（role 0 待開通）、登入 → `{ token, user }` |
| GET／PATCH | `/api/me` | 帳號 | 自己的帳號；PATCH 只能改稱呼、身分類別 |
| GET | `/api/me/feedback`、`/api/me/feedback/:id/photo/:a/:p` | 帳號 | 自己的回饋（含審核狀態）、照片 |
| GET／POST | `/api/me/videos` | 帳號 | 自己的影片紀錄；POST 登記已上傳到 Firebase 的影片（身分 2、3） |
| POST | `/api/feedback` | 帳號 | 送出志工回饋（身分 1、3；需附開始走訪的定位，距離 ≤ 50m） |
| GET | `/api/feedback` | ✓ | 回饋列表（不含照片本體） |
| GET | `/api/feedback/:id/photo/:a/:p` | ✓ | 照片（JPEG） |
| PATCH | `/api/feedback/:id` | ✓ | 審核 `{ status, reviewNote }` |
| POST | `/api/integrate` | ✓ | 執行模組四 |
| GET | `/api/integrated` | | 綜合評級 GeoJSON |
| GET | `/api/priorities.csv` | ✓ | 匯出需改善路段 |
| GET／PATCH | `/api/users`、`/api/users/:id` | ✓ | 帳號列表；改身分 `{ role }`、重設密碼 `{ password }` |
| GET／PATCH | `/api/videos`、`/api/videos/:id` | ✓ | 影片列表；更新 `{ processing, adminNote }` |

需要 PIN 的 API 用 header `x-admin-pin` 傳入；需要帳號的用 `Authorization: Bearer <token>`。照片和 CSV 是瀏覽器直接下載的連結，改用 query `?pin=`／`?token=`。
