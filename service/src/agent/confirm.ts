/**
 * 写操作的确认令牌：第一次调用只发令牌，第二次带上令牌且**参数一致**才执行。
 *
 * 目的是让模型不能单方面落库：pi 会把这个错误转成「请先向用户展示内容并取得同意」，
 * 用户同意后模型才带令牌重试。令牌一次性、10 分钟过期、绑定工具名与参数指纹。
 */
import crypto from 'node:crypto'

const TTL_MS = 10 * 60 * 1000
const pending = new Map<string, { tool: string; fingerprint: string; expiresAt: number }>()

/** 稳定序列化（键排序 + 去掉令牌字段），保证「同一次写入」指纹一致。 */
function fingerprint(tool: string, args: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '__confirm_token')
        .sort(([a], [b]) => a.localeCompare(b))
      return Object.fromEntries(entries.map(([key, val]) => [key, stable(val)]))
    }
    return value
  }
  return crypto.createHash('sha256').update(`${tool}:${JSON.stringify(stable(args))}`).digest('hex')
}

export function issueConfirmToken(tool: string, args: unknown): string {
  const token = crypto.randomBytes(16).toString('hex')
  prune()
  pending.set(token, { tool, fingerprint: fingerprint(tool, args), expiresAt: Date.now() + TTL_MS })
  return token
}

export type ConfirmCheck = { ok: true } | { ok: false; reason: string }

export function consumeConfirmToken(token: string, tool: string, args: unknown): ConfirmCheck {
  prune()
  const entry = pending.get(token)
  if (!entry) return { ok: false, reason: '确认令牌无效或已过期，请重新调用（会再发一个新令牌）' }
  if (entry.tool !== tool) return { ok: false, reason: '确认令牌与工具不匹配，请重新调用' }
  if (entry.fingerprint !== fingerprint(tool, args)) {
    return { ok: false, reason: '确认令牌与参数不匹配（内容被改过），请重新调用并让用户确认新内容' }
  }
  pending.delete(token)
  return { ok: true }
}

function prune(): void {
  const now = Date.now()
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token)
  }
}

/** 测试用。 */
export function clearConfirmTokens(): void {
  pending.clear()
}
