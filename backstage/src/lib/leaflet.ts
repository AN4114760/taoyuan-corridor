// 依序：先設定全域 L（leaflet-global），再載入使用全域 L 的外掛
import L from './leaflet-global'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

export default L
