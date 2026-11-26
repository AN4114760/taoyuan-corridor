// leaflet.markercluster 的 UMD 版本直接使用全域 L，必須在 import 外掛之前先掛上
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

;(window as unknown as { L: typeof L }).L = L

export default L
