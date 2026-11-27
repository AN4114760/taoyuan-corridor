// 障礙物素材：public/icons/obstacle-*.svg（純物件版，240×280）→ 產生 pin-*.svg（紅色水滴地標版，280×340）與 preview.html
// 用法：node scripts/build_icon_pins.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/icons')
const NAMES = {
  scooter: '機車停放佔用', car: '違停轎車', cone: '施工三角錐', pothole: '人行道坑洞',
  signboard: '店家佔用立牌', trash: '堆置垃圾袋', box: '變電箱',
}

const PIN = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 340" width="280" height="340">
  <ellipse cx="140" cy="316" rx="44" ry="12" fill="#1F2937" fill-opacity="0.28" />
  <g stroke="#22292F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 140 16 C 72 16, 26 68, 26 130 C 26 202, 114 276, 134 306 C 137 310, 143 310, 146 306 C 166 276, 254 202, 254 130 C 254 68, 208 16, 140 16 Z" fill="#DC2626" />
    <path d="M 140 19 C 204 19, 251 69, 251 130 C 251 198, 168 270, 144 304 C 142 307, 140 307, 140 307 C 160 272, 232 198, 232 130 C 232 74, 192 26, 140 19 Z" fill="#B91C1C" stroke="none" />
    <path d="M 52 94 C 62 56, 94 34, 130 30" stroke="#FCA5A5" stroke-width="5" fill="none" />
    <circle cx="46" cy="110" r="3" fill="#FCA5A5" stroke="none" />
    <circle cx="140" cy="128" r="84" fill="#FFFFFF" stroke="#22292F" stroke-width="4.5" />
  </g>
  <g transform="translate(68, 44) scale(0.6)">
${inner}
  </g>
</svg>
`

const kinds = readdirSync(DIR).filter((f) => /^obstacle-.*\.svg$/.test(f)).map((f) => f.slice(9, -4))
for (const k of kinds) {
  const src = readFileSync(join(DIR, `obstacle-${k}.svg`), 'utf8')
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .split('\n').filter((l) => !l.includes('class="ground"')).map((l) => `  ${l}`).join('\n')
  writeFileSync(join(DIR, `pin-${k}.svg`), PIN(inner))
}

const cell = (k) => `<figure><div class="pair"><img src="obstacle-${k}.svg" alt=""><img src="pin-${k}.svg" alt=""></div>
  <figcaption><b>${NAMES[k] ?? k}</b><code>obstacle-${k}.svg</code><code>pin-${k}.svg</code></figcaption></figure>`
writeFileSync(join(DIR, 'preview.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>障礙物素材預覽</title>
<style>
  body { margin: 0; padding: 24px 16px; font-family: system-ui, sans-serif; background: #f3f4f6; color: #22292F; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 18px; color: #555; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  figure { margin: 0; background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .pair img { width: 100%; height: 150px; object-fit: contain; }
  .pair img:first-child { background: #c9c3b8; border-radius: 10px; }
  figcaption { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: 13px; }
  code { color: #6B7280; font-size: 12px; }
  .row { display: flex; gap: 18px; align-items: end; flex-wrap: wrap; background: #8cc56a; border-radius: 14px; padding: 16px; margin-top: 18px; }
  .row img { height: 96px; }
</style></head><body>
<h1>障礙物素材（2D 扁平賽璐珞風）</h1>
<p>左：純物件版（240×280，放在人行道磚色背景上）　右：紅色水滴地標版（280×340）</p>
<div class="grid">
${kinds.map(cell).join('\n')}
</div>
<div class="row">${kinds.map((k) => `<img src="obstacle-${k}.svg" alt="">`).join('')}<img src="/frog/back.png" alt="" style="height:110px"></div>
</body></html>
`)
console.log(`產生 ${kinds.length} 個水滴地標版與 preview.html：${kinds.join(', ')}`)
