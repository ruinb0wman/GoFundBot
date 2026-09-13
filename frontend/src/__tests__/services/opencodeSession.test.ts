import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENCODE_SESSION_HEADER,
  isOpencodeHost,
  sessionIdFor,
  withOpencodeSession,
} from '../../services/opencodeSession'
import { nativeFetch } from '../../services/httpClient'

const CONV_KEY = (id: string) => `gofund:opencode-session:conv:${id}`
const PAGE_KEY = 'gofund:opencode-session:page'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('sessionIdFor', () => {
  it('returns the same UUID for the same conversationId', () => {
    const first = sessionIdFor('chat:1')
    const second = sessionIdFor('chat:1')

    expect(first).toBe(second)
    expect(first).toMatch(UUID_V4)
  })

  it('returns different UUIDs for different conversationIds', () => {
    expect(sessionIdFor('chat:1')).not.toBe(sessionIdFor('chat:2'))
  })

  it('persists the conversation id in localStorage', () => {
    const id = sessionIdFor('chat:7')

    expect(localStorage.getItem(CONV_KEY('chat:7'))).toBe(id)
    expect(localStorage.getItem(CONV_KEY('chat:7'))).toMatch(UUID_V4)
  })

  it('reuses a pre-existing stored value', () => {
    localStorage.setItem(CONV_KEY('chat:9'), 'preset-uuid')

    expect(sessionIdFor('chat:9')).toBe('preset-uuid')
  })

  it('degrades to a stable per-tab id when no conversation is given', () => {
    const a = sessionIdFor(null)
    const b = sessionIdFor(undefined)
    const c = sessionIdFor('')

    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).toMatch(UUID_V4)
    expect(a).not.toBe(sessionIdFor('chat:1'))
    expect(sessionStorage.getItem(PAGE_KEY)).toBe(a)
  })

  it('falls back to an in-memory id when Web Storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(sessionIdFor('chat:blocked')).toBe(sessionIdFor('chat:blocked'))

    spy.mockRestore()
    setSpy.mockRestore()
  })
})

describe('isOpencodeHost', () => {
  it.each([
    ['https://opencode.ai/zen/v1/chat/completions', true],
    ['https://api.opencode.ai/go/v1/chat/completions', true],
    ['https://OPENCODE.AI/zen/v1', true],
    ['https://opencode.ai.evil.com/zen/v1', false],
    ['https://evilopencode.ai/zen/v1', false],
    ['https://api.siliconflow.cn/v1/chat/completions', false],
    ['/api/fund/detail', false],
    ['ftp://opencode.ai/zen/v1', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isOpencodeHost(url)).toBe(expected)
  })
})

describe('withOpencodeSession', () => {
  it('attaches the header for opencode hosts and keeps existing headers', () => {
    const init = withOpencodeSession('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
    }, 'chat:3')

    expect(headerOf(init, OPENCODE_SESSION_HEADER)).toBe(sessionIdFor('chat:3'))
    expect(headerOf(init, 'Authorization')).toBe('Bearer sk-test')
  })

  it('accepts Headers and tuple-array init headers', () => {
    const fromHeaders = withOpencodeSession('https://opencode.ai/go/v1', {
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })
    const fromArray = withOpencodeSession('https://opencode.ai/go/v1', {
      headers: [['X-Trace', 'abc']],
    })

    expect(headerOf(fromHeaders, OPENCODE_SESSION_HEADER)).toBe(sessionIdFor(null))
    expect(headerOf(fromHeaders, 'Content-Type')).toBe('application/json')
    expect(headerOf(fromArray, 'X-Trace')).toBe('abc')
  })

  it('leaves non-opencode requests untouched', () => {
    const init: RequestInit = { method: 'POST', headers: { Authorization: 'Bearer x' } }
    const result = withOpencodeSession('https://api.siliconflow.cn/v1/chat/completions', init)

    expect(result).toBe(init)
    expect(headerOf(result, OPENCODE_SESSION_HEADER)).toBeNull()
  })
})

describe('nativeFetch', () => {
  it('injects the session header for opencode hosts only', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await nativeFetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST' }, 'chat:11')
    await nativeFetch('https://api.siliconflow.cn/v1/chat/completions', { method: 'POST' }, 'chat:11')
    await nativeFetch('/api/fund/detail')

    expect(headerOf(fetchSpy.mock.calls[0][1] as RequestInit, OPENCODE_SESSION_HEADER)).toBe(sessionIdFor('chat:11'))
    expect(headerOf(fetchSpy.mock.calls[1][1] as RequestInit, OPENCODE_SESSION_HEADER)).toBeNull()
    expect(headerOf(fetchSpy.mock.calls[2][1] as RequestInit, OPENCODE_SESSION_HEADER)).toBeNull()
  })

  it('uses the per-tab id when no conversation is supplied', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await nativeFetch('https://opencode.ai/go/v1/chat/completions', { method: 'POST' })

    expect(headerOf(fetchSpy.mock.calls[0][1] as RequestInit, OPENCODE_SESSION_HEADER)).toBe(sessionIdFor(null))
  })
})
