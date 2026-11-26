/** 照片上傳前壓縮：長邊 1280px、JPEG 0.72，約 150–250KB（手機原圖常 4–8MB） */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('照片壓縮失敗'))), 'image/jpeg', quality))
}

/** 壓縮後轉成 data URL（地端後台以 base64 存在 feedback.json） */
export async function compressToDataUrl(file: File): Promise<string> {
  const blob = await compressImage(file)
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** 目前位置（瀏覽器只在 https 或 localhost 允許定位） */
export function currentPosition(timeout = 15000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error('目前用 http 連線，瀏覽器不允許定位，請直接在地圖上點選位置'))
    if (!('geolocation' in navigator)) return reject(new Error('此裝置不支援定位'))
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout, maximumAge: 10000 })
  })
}
