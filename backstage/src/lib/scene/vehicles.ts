// 車道上的來車：沿用障礙物素材（obstacle-car.svg、obstacle-scooter.svg）換色，避開綠色與藍色。
// 汽車只換標了 data-paint 的車身色塊（車牌、車燈不變）；機車換紅色系三個色（主色、暗面、高光）。

export const CAR_PAINTS = [
  { body: '#FFFFFF', shade: '#CBD5E1' }, // 白
  { body: '#DC2626', shade: '#991B1B' }, // 紅
  { body: '#CBD5E1', shade: '#9CA3AF' }, // 銀
  { body: '#F59E0B', shade: '#B45309' }, // 計程車黃
  { body: '#4B5563', shade: '#22292F' }, // 黑
]
export const SCOOTER_PAINTS = [
  { main: '#DC2626', dark: '#991B1B', hi: '#FCA5A5' }, // 紅（原色）
  { main: '#EA580C', dark: '#B45309', hi: '#FDE68A' }, // 橘
  { main: '#FFFFFF', dark: '#CBD5E1', hi: '#E2E8F0' }, // 白
  { main: '#9CA3AF', dark: '#6B7280', hi: '#E2E8F0' }, // 灰
  { main: '#4B5563', dark: '#22292F', hi: '#9CA3AF' }, // 黑
]

export function recolorCar(svg: string, p: (typeof CAR_PAINTS)[number]) {
  return svg
    .replace(/fill="#[0-9A-Fa-f]{6}" data-paint="body"/g, `fill="${p.body}" data-paint="body"`)
    .replace(/fill="#[0-9A-Fa-f]{6}" data-paint="shade"/g, `fill="${p.shade}" data-paint="shade"`)
}
export function recolorScooter(svg: string, p: (typeof SCOOTER_PAINTS)[number]) {
  return svg.replace(/#DC2626/gi, p.main).replace(/#991B1B/gi, p.dark).replace(/#FCA5A5/gi, p.hi)
}

const toImage = (svg: string) => {
  const img = new Image()
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  return img
}

/** 載入所有顏色的來車圖 */
export async function loadTraffic(): Promise<{ car: HTMLImageElement[]; scooter: HTMLImageElement[] }> {
  const [car, scooter] = await Promise.all(['car', 'scooter'].map((k) => fetch(`/icons/obstacle-${k}.svg`).then((r) => r.text())))
  return { car: CAR_PAINTS.map((p) => toImage(recolorCar(car, p))), scooter: SCOOTER_PAINTS.map((p) => toImage(recolorScooter(scooter, p))) }
}
