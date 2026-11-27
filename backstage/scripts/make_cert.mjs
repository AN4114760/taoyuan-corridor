// 產生自簽 https 憑證到 backstage/.cert/（npm run cert）。
// 手機瀏覽器只在 https 下允許定位；憑證包含本機所有區網 IP，換了網路（IP 變了）要重新產生。
// 需要 openssl 指令：Mac 內建；Windows 的 Git Bash 內建（或用 Git 安裝目錄下的 usr/bin/openssl.exe）。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.cert')
mkdirSync(dir, { recursive: true })

const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4').map((i) => i.address)
const san = ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',')
const cnf = join(dir, 'openssl.cnf')
writeFileSync(cnf, `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = taoyuan-corridor-local
[ext]
subjectAltName = ${san}
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
`)

const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe']
const openssl = candidates.find((c) => c === 'openssl' || existsSync(c))
try {
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-config', cnf], { stdio: 'pipe' })
} catch (e) {
  console.error('產生失敗：找不到 openssl 或執行錯誤。Windows 請在 Git Bash 執行 npm run cert。\n', e.message)
  process.exit(1)
}
console.log(`已產生 ${dir}\n包含：${san}\n重新執行 npm start 後，手機改開 https://<IP>:8443/`)
