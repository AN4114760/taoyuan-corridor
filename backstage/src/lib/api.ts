// 呼叫地端伺服器（backstage/server.mjs）。後台 API 需要 PIN，存在 sessionStorage（關掉分頁就要重新輸入）。
const PIN_KEY = 'adminPin'

export function getPin(): string {
  try { return sessionStorage.getItem(PIN_KEY) ?? '' } catch { return '' }
}
export function setPin(pin: string | null) {
  try { if (pin) sessionStorage.setItem(PIN_KEY, pin); else sessionStorage.removeItem(PIN_KEY) } catch { /* 無痕模式 */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.admin) headers['x-admin-pin'] = getPin()
  let res: Response
  try {
    res = await fetch(`/api/${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  } catch {
    throw new ApiError(0, '連不到後台伺服器，請確認伺服器電腦已開啟，且在同一個 Wi-Fi')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `伺服器錯誤（${res.status}）`)
  return data as T
}

export const photoUrl = (feedbackId: string, anomaly: number, photo: number) =>
  `/api/feedback/${encodeURIComponent(feedbackId)}/photo/${anomaly}/${photo}?pin=${encodeURIComponent(getPin())}`

export const prioritiesCsvUrl = () => `/api/priorities.csv?pin=${encodeURIComponent(getPin())}`
