# 桃園醫養無障礙廊道地圖｜SVG Icon 規格與 Claude 交接說明

## 設計方向

- 參考目前地圖：淺灰底圖、道路狀態以綠／黃／紅／深灰線段表達。圖標採白底圓形、深藍灰描邊、單一彩色識別點，避免搶過道路狀態圖層。
- 畫布 48×48，viewBox 0 0 48 48；外圈半徑 21，圖形置中於 24×24 區域。
- 描邊色 `#334155`，描邊寬 1.65；底色 `#FFFFFF`。各類別色只作右上角識別點，不代表道路安全等級。
- 所有 SVG 都是獨立檔案，可直接作為 `<img>`、CSS background 或地圖 Marker 圖片。`sprite.svg` 可作為 symbol sprite 使用。

## 圖標清單

| 檔名 | 顯示名稱 | 用途／資料欄位建議 | 類別色 |
|---|---|---|---|
| `hospital.svg` | 醫院 | 醫療機構；可作為主要目的地或就醫廊道終點 | `#2563EB` |
| `clinic.svg` | 診所 | 基層醫療服務點；本研究若排除診所，可保留圖層但預設關閉 | `#0D9488` |
| `care-home.svg` | 安養機構 | 長者照護與住宿式機構；作為高齡友善就醫／生活廊道的服務節點 | `#7C3AED` |
| `access-ramp.svg` | 無障礙坡道 | 供輪椅及行動不便者通行的坡道；現地確認坡度、寬度、側向高差與銜接是否連續 | `#16A34A` |
| `bus-stop.svg` | 公車站 | 大眾運輸到達節點；需檢查候車空間、站牌可及性與通往機構的連續路徑 | `#D97706` |
| `accessible-parking.svg` | 身障優先車格 | 無障礙停車供給點；現地確認標線、標誌、車格尺寸與無障礙通道銜接 | `#2563EB` |
| `accessible-pickup.svg` | 無障礙上下車點 | 輪椅上下車與臨停節點；需檢查路側停靠空間、車門展開空間及路緣坡道距離 | `#EA580C` |
| `tactile-paving.svg` | 導盲磚 | 視障者引導設施；記錄是否連續、方向是否正確，以及是否被障礙物阻斷 | `#CA8A04` |
| `audible-signal.svg` | 有聲號誌 | 協助視障者辨識通行時相；記錄設備位置、可操作性與聲音提示狀態 | `#0891B2` |
| `crosswalk.svg` | 行人穿越道 | 廊道跨越道路的節點；需檢查行穿線、庇護空間、行人號誌與路緣坡道對位 | `#475569` |

## 地圖資料欄位建議

```ts
type FacilityType = "hospital" | "clinic" | "care-home";
type AccessFeatureType = "access-ramp" | "tactile-paving" | "audible-signal" | "crosswalk";
type TransitType = "bus-stop" | "accessible-pickup" | "accessible-parking";

interface MapFeature {
  id: string;
  type: FacilityType | AccessFeatureType | TransitType;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  source?: "field-survey" | "government-data" | "osm" | "ai-detected";
  verified?: boolean;
  notes?: string;
  properties?: Record<string, unknown>;
}
```

## Popup／資訊卡建議

- 醫院：名稱、地址、機構層級、主要入口、最近公車站、廊道評級。
- 診所：名稱、地址、服務類別、是否納入本次研究範圍（目前提案研究範圍排除診所）。
- 長照／安養機構：機構名稱、機構類型、地址、主要出入口、最近上下車點、廊道評級。
- 無障礙坡道：位置、坡道形式、坡度、有效淨寬、是否有側向高差、是否銜接導盲磚、現勘照片、驗證狀態。
- 公車站：站名、路線、站牌方向、候車空間、站點至機構入口路徑、資料來源。
- 身障優先車格：位置、車格數、標線／標誌狀態、車格至人行道的銜接、是否有障礙物。
- 無障礙上下車點：類型（復康巴士／無障礙計程車）、可否臨停、上下車側空間、最近坡道、是否經主管機關確認。
- 導盲磚／有聲號誌／行穿線：設施狀態、連續性、現地驗證、照片與備註。

## 顯示與互動規則

1. 機構類（醫院、診所、長照機構）使用較大的 48px Marker；設施類可用 36–40px，避免密集區遮蔽道路。
2. Marker 點擊後顯示資訊卡；滑鼠 hover 顯示名稱。密集點位採 cluster，縮放後再展開。
3. 未經現地確認的 AI 偵測結果必須標示「待確認」，不可與已驗證設施混為一談。
4. 圖標顏色只表示設施類別，不得用來表示 A/B/C/D 廊道評級；廊道評級沿用地圖道路線色或獨立欄位。
5. 提案研究範圍目前排除診所，診所圖標可先保留在元件庫，但預設不顯示於本研究成果圖層。
6. 無障礙坡道圖標表示「坡道設施位置」，不代表坡道符合規範或可通行；是否合格由屬性與現勘結果決定。

## 給 Claude 的整合指令

請將本資料夾中的 SVG 圖標整合到既有地圖，不要改動現有底圖、道路線段顏色與道路狀態判讀方式。建立依 `type` 對應 SVG 的 marker factory，保留圖標尺寸、白底圓形、深藍灰描邊與右上角類別色點。新增圖層開關與點擊資訊卡，並支援點位聚合。所有 AI 判釋點位預設 `verified: false`，資訊卡明確顯示待現勘。道路廊道 A/B/C/D 評級與設施類別圖標必須分開呈現。

## 使用範例

```html
<img src="/icons/hospital.svg" width="48" height="48" alt="醫院" />
```

```js
// Leaflet 範例：
const marker = L.marker([lat, lng], {
  icon: L.icon({
    iconUrl: `/icons/${feature.type}.svg`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -18]
  })
});
```
