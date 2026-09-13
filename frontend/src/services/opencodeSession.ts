/**
 * OpenCode Go/Zen session header (`x-opencode-session`).
 *
 * OpenCode requires every request to carry a session id that stays stable for
 * the whole conversation (routing + prompt cache); a missing header makes the
 * upstream reject the call with `400 MissingSessionID`.
 *
 * Stability rules:
 * - a real conversation (`chat:<Dexie chatSessions.id>`) maps to a persisted
 *   UUID v4 in localStorage, so refreshing the page keeps the same id;
 * - flows without a conversation concept (analysis, drafting, reflections,
 *   log analysis) degrade to one UUID per browser tab in sessionStorage.
 *
 * The header is only ever attached to `opencode.ai` / `*.opencode.ai` hosts, so
 * every other provider keeps its exact request shape (no extra CORS preflight).
 * `User-Agent` is never touched — browsers forbid JS from setting it.
 */

export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

/** localStorage key prefix for conversation-scoped ids. */
const CONVERSATION_KEY_PREFIX = 'gofund:opencode-session:conv:'
/** sessionStorage key for the per-tab fallback id. */
const PAGE_KEY = 'gofund:opencode-session:page'

/** Last resort cache when Web Storage is unavailable (private mode / SSR). */
const memoryStore = new Map<string, string>()

/** RFC4122 v4 UUID, with fallbacks for runtimes lacking `crypto.randomUUID`. */
function randomUuid(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (typeof uuid === 'string' && uuid) return uuid

  const bytes = new Uint8Array(16)
  const webCrypto = globalThis.crypto
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function readStored(key: string): string | null {
  try {
    const store = key === PAGE_KEY ? sessionStorage : localStorage
    const value = store.getItem(key)
    if (value) return value
  } catch {
    // Web Storage blocked — fall through to the in-memory cache
  }
  return memoryStore.get(key) ?? null
}

function writeStored(key: string, value: string): void {
  memoryStore.set(key, value)
  try {
    const store = key === PAGE_KEY ? sessionStorage : localStorage
    store.setItem(key, value)
  } catch {
    // ignore — the in-memory cache keeps the id stable for this page session
  }
}

/**
 * Stable UUID for a conversation. A blank / missing conversation id degrades to
 * the per-tab (sessionStorage) id.
 */
export function sessionIdFor(conversationId?: string | null): string {
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  const key = id ? `${CONVERSATION_KEY_PREFIX}${id}` : PAGE_KEY
  const existing = readStored(key)
  if (existing) return existing
  const created = randomUuid()
  writeStored(key, created)
  return created
}

/** True only for `opencode.ai` and its subdomains over http(s). */
export function isOpencodeHost(url: string): boolean {
  let host: string
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined
    const parsed = new URL(url, base)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    host = parsed.hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'opencode.ai' || host.endsWith('.opencode.ai')
}

/**
 * Attach `x-opencode-session` to opencode-hosted requests. Non-opencode URLs
 * get the original `init` back untouched.
 */
export function withOpencodeSession(
  input: string,
  init?: RequestInit,
  conversationId?: string | null,
): RequestInit {
  if (!isOpencodeHost(input)) return init ?? {}
  const headers = new Headers(init?.headers)
  headers.set(OPENCODE_SESSION_HEADER, sessionIdFor(conversationId))
  return { ...init, headers }
}
