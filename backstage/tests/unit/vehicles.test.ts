import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CAR_PAINTS, recolorCar, recolorScooter, SCOOTER_PAINTS } from '@/lib/scene/vehicles'

const read = (k: string) => readFileSync(join(__dirname, `../../public/icons/obstacle-${k}.svg`), 'utf8')
const isGreenOrBlue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (g > r + 30 && g > b) || (b > r + 30 && b > g)
}

describe('來車換色', () => {
  it('汽車只換車身：車牌、車燈不變', () => {
    const red = recolorCar(read('car'), CAR_PAINTS[1])
    expect(red.match(/data-paint="body"/g)).toHaveLength(4)
    expect(red).toContain('fill="#DC2626" data-paint="body"')
    expect(red).toContain('<rect x="98" y="192" width="52" height="24" rx="5" fill="#FFFFFF" />') // 車牌
    expect(red).toContain('fill="#FDE68A"') // 車燈
  })
  it('機車換掉所有紅色', () => {
    const grey = recolorScooter(read('scooter'), SCOOTER_PAINTS[3])
    expect(grey).not.toMatch(/#DC2626|#991B1B|#FCA5A5/i)
  })
  it('所有顏色都避開綠色與藍色', () => {
    for (const p of CAR_PAINTS) expect([p.body, p.shade].some(isGreenOrBlue)).toBe(false)
    for (const p of SCOOTER_PAINTS) expect([p.main, p.dark, p.hi].some(isGreenOrBlue)).toBe(false)
  })
})
