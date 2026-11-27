// 資料格式：與 docs/data-contract.md、firestore.rules、module4/integrate.py 一致

export type Level = 'good' | 'caution' | 'severe' | 'missing'
export type Grade = 'A' | 'B' | 'C' | 'D'

export const LEVEL_COLOR: Record<Level, string> = {
  good: '#2bb24c', caution: '#f5c400', severe: '#e5322d', missing: '#555555',
}
export const LEVEL_LABEL: Record<Level, string> = {
  good: '正常', caution: '需注意', severe: '嚴重', missing: '無人行道',
}
export const GRADE_COLOR: Record<Grade, string> = {
  A: '#2bb24c', B: '#f5c400', C: '#f08a24', D: '#e5322d',
}
export const GRADE_LABEL: Record<Grade, string> = {
  A: 'A 良好', B: 'B 尚可', C: 'C 待改善', D: 'D 優先改善',
}

export interface SegmentStats {
  grade?: Grade
  integrated?: Integrated
}

export interface Segment {
  id: string
  facility_id: string
  kind: 'sidewalk' | 'missing'
  level: Level
  label: string
  road_name?: string | null
  from?: string | null
  to?: string | null
  side?: string | null
  width_m?: number | null
  net_width_m?: number | null
  ramps?: number | null
  canopy_overlap_ratio?: number | null
  photo_year?: number | null
  geometry: string            // GeoJSON geometry（字串；Firestore 不支援巢狀陣列）
  centroid: { lat: number; lng: number }
  stats?: SegmentStats
}

export const CATEGORIES = {
  'tree-obstruction': '路樹／植栽阻擋',
  'parked-vehicle': '機車／汽車佔用',
  'broken-surface': '鋪面破損／高低差',
  'no-ramp': '缺少或不良的斜坡',
  'tactile-broken': '導盲磚中斷／錯誤',
  'too-narrow': '通行寬度不足',
  'no-sidewalk': '沒有人行道',
  'pickup-problem': '無法上下車（復康巴士／計程車）',
  other: '其他',
} as const
export type Category = keyof typeof CATEGORIES

export const FEEDBACK_STATUS = { new: '待審核', confirmed: '已確認', rejected: '不成立' } as const
export type FeedbackStatus = keyof typeof FEEDBACK_STATUS

export interface Anomaly {
  category: Category
  note?: string
  photoCount: number          // 照片另以 /api/feedback/:id/photo/:a/:p 取得（JSON 內為 base64）
  /** 走路模式標注的位置（along：距路段起點公尺） */
  lat?: number
  lng?: number
  along?: number
  hotspotId?: string
}

/** 走路模式：沿路某一點的主觀安全感（含走到團隊標注點時的回答） */
export interface Moment {
  at?: string
  lat: number
  lng: number
  along: number
  safety: number              // 1–5（5 最安全）
  tags?: string[]
  note?: string
  hotspotId?: string
}

/** 志工回饋：行經路段感受＋有異狀的照片（backstage/data/feedback.json） */
export interface Feedback {
  id: string
  createdAt: string           // ISO 8601
  volunteerName?: string
  participantGroup: ParticipantGroup
  segId: string
  lat: number
  lng: number
  safety: number              // 1–5（5 最安全）
  comfort: number             // 1–5
  comment?: string
  anomalies: Anomaly[]
  moments?: Moment[]
  status: FeedbackStatus
  reviewNote?: string
  reviewedAt?: string
  demo?: boolean
  /** App 帳號（舊資料、假資料沒有） */
  userId?: string
  /** 開始走這段路時的定位檢查（需在路段 50m 內） */
  walk?: { startedAt: string; startLat: number; startLng: number; startDistanceM: number; startAccuracyM?: number }
}

/** App 帳號身分：只有後台能改。0 待開通、1 志工回饋、2 錄影、3 志工＋錄影 */
export type Role = 0 | 1 | 2 | 3
export const ROLE_LABEL: Record<Role, string> = { 0: '待開通', 1: '志工', 2: '錄影人員', 3: '志工＋錄影' }
export const canVolunteer = (r?: Role) => r === 1 || r === 3
export const canRecord = (r?: Role) => r === 2 || r === 3

/** App 帳號（backstage/data/users.json；不含密碼） */
export interface AppUser {
  id: string
  phone: string
  name: string
  participantGroup: ParticipantGroup
  role: Role
  createdAt: string
  updatedAt: string
  feedbackCount?: number      // 後台列表才有
  videoCount?: number
}

/** module4/integrate.py 寫進 integrated.geojson 的每段結果 */
export interface Integrated {
  composite_score: number
  grade: Grade
  components: { m1: number; anomalies: number; m2: number; safety: number }
  counts: { confirmed_anomalies: number; m2_detections: number; ratings: number }
  safety_mean: number | null
}

/** 模組二：車行影像 + VLM 偵測結果 */
export interface DriveDetection {
  id?: string
  sessionId: string
  ts: string                  // ISO 8601
  lat: number
  lng: number
  heading?: number | null
  segId?: string | null
  label: string               // Category 或 MapFeature type（access-ramp、bus-stop…）
  confidence: number          // 0–1
  model: string               // 例如 gemini-2.5-flash、sam3
  framePath?: string | null
  verified: boolean
  demo?: boolean
}

export const PARTICIPANT_GROUPS = {
  wheelchair: '輪椅使用者', elderly: '高齡者', 'visually-impaired': '視障者', general: '一般民眾',
} as const
export type ParticipantGroup = keyof typeof PARTICIPANT_GROUPS

/** 模組三：互動遊戲 / 實走主觀評分 */
export interface WalkRating {
  id?: string
  sessionId: string
  source: 'game' | 'field'
  participantGroup: ParticipantGroup
  segId?: string | null
  lat?: number | null
  lng?: number | null
  safety: number              // 1–5（5 最安全）
  comfort: number             // 1–5
  issues: string[]            // Category
  ts: string
  demo?: boolean
}

/** 錄影上傳紀錄（backstage/data/videos.json；影片檔本身在 Firebase Storage） */
export const VIDEO_PROCESSING = {
  pending: '等待處理', processing: '處理中', processed: '已處理', unusable: '無法使用',
} as const
export type VideoProcessing = keyof typeof VIDEO_PROCESSING

export interface Video {
  id: string
  userId: string
  recorderName: string
  fileName: string
  sizeBytes: number
  contentType: string
  note?: string
  recordedAt: string          // 拍攝時間（取檔案修改時間），ISO 8601
  uploadedAt: string          // ISO 8601
  storagePath: string         // Firebase Storage 路徑
  downloadUrl: string         // Firebase 下載網址（播放用）
  processing: VideoProcessing // 後台處理狀態（由管理者更新）
  adminNote?: string
}

export type FeatureType =
  | 'hospital' | 'clinic' | 'care-home'
  | 'access-ramp' | 'tactile-paving' | 'audible-signal' | 'crosswalk'
  | 'bus-stop' | 'accessible-pickup' | 'accessible-parking'

/** 設施點位（icons/README.md 的 MapFeature） */
export interface MapFeature {
  id: string
  type: FeatureType
  name: string
  lat: number
  lng: number
  address?: string | null
  source?: 'field-survey' | 'government-data' | 'osm' | 'ai-detected'
  verified?: boolean
  notes?: string
  properties?: Record<string, unknown>
}
