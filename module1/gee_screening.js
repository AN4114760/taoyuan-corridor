// 模組一｜第一層：Sentinel-2 區域篩選（貼進 https://code.earthengine.google.com 執行）
//
// 準備：
// 1. 執行 fetch_facilities.py --build 產生 data/processed/facilities.geojson
// 2. 在 GEE Code Editor 左側 Assets → NEW → Table upload，上傳 facilities.geojson
//    （或先轉成 CSV：需有 facility_id, name, type, longitude, latitude 欄位）
// 3. 把下面 FACILITIES_ASSET 改成你的資產路徑
//
// 輸出：Google Drive 的 taoyuan_facility_indices.csv（每家機構 500m 內的 NDVI、NDBI 平均）
// 資料：Contains modified Copernicus Sentinel data [2025–2026]；Cloud Score+（CC-BY-4.0）

var FACILITIES_ASSET = 'projects/你的專案/assets/taoyuan_facilities';
var BUFFER_M = 500;
var START = '2025-11-01', END = '2026-11-01';
var CLEAR_THRESHOLD = 0.60;   // Cloud Score+ 官方建議 0.50–0.65

var facilities = ee.FeatureCollection(FACILITIES_ASSET);
var buffers = facilities.map(function (f) { return f.buffer(BUFFER_M); });

// 去雲中位數合成
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
var composite = s2
  .filterBounds(buffers.geometry())
  .filterDate(START, END)
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(CLEAR_THRESHOLD)); })
  .median();

// 指標：NDVI（綠覆、遮蔭潛力）、NDBI（建成、不透水；B11 為 20m）
var ndvi = composite.normalizedDifference(['B8', 'B4']).rename('NDVI');
var ndbi = composite.normalizedDifference(['B11', 'B8']).rename('NDBI');
var indices = ndvi.addBands(ndbi);

var stats = indices.reduceRegions({
  collection: buffers,
  reducer: ee.Reducer.mean(),
  scale: 10
}).map(function (f) { return f.setGeometry(null); });

// 檢視
Map.centerObject(buffers, 11);
Map.addLayer(composite, {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500}, '真色合成');
Map.addLayer(ndvi, {min: 0, max: 0.8, palette: ['white', 'green']}, 'NDVI', false);
Map.addLayer(ndbi, {min: -0.3, max: 0.3, palette: ['blue', 'white', 'red']}, 'NDBI', false);
Map.addLayer(buffers, {color: 'yellow'}, '機構 500m');

Export.table.toDrive({
  collection: stats,
  description: 'taoyuan_facility_indices',
  fileFormat: 'CSV',
  selectors: ['facility_id', 'name', 'type', 'NDVI', 'NDBI']
});
