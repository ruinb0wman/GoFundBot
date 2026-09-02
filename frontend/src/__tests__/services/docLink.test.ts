import { describe, expect, it, vi, afterEach } from 'vitest'
import { docUrl, openDocLink, isTauriRuntime } from '../../services/docLink'

const openDocsMock = vi.fn()
vi.mock('../../stores/docsStore', () => ({
  useDocsStore: () => ({ openDocs: openDocsMock }),
}))

describe('docUrl', () => {
  it('joins a directory-route path verbatim (trailing slash preserved)', () => {
    expect(docUrl('/docs/strategy/', 'http://localhost:8517')).toBe(
      'http://localhost:8517/docs/strategy/',
    )
  })

  it('joins a file-route path verbatim (no trailing slash added)', () => {
    expect(docUrl('/docs/market-index-trend', 'http://localhost:8517')).toBe(
      'http://localhost:8517/docs/market-index-trend',
    )
  })

  it('builds a canonical prod-origin docs url for directory routes', () => {
    expect(docUrl('/docs/fund-screening/', 'http://localhost:8417')).toBe(
      'http://localhost:8417/docs/fund-screening/',
    )
  })

  it('normalizes a missing leading slash', () => {
    expect(docUrl('docs/market-news', 'http://localhost:8517')).toBe(
      'http://localhost:8517/docs/market-news',
    )
  })

  it('defaults to the live location origin when omitted', () => {
    expect(docUrl('/docs/strategy/')).toBe(`${window.location.origin}/docs/strategy/`)
  })
})

describe('openDocLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not prevent default in the browser so the anchor opens a new tab', () => {
    // jsdom window has no __TAURI_INTERNALS__ → web runtime
    const event = new MouseEvent('click', { cancelable: true })
    openDocLink(event, '/docs/strategy/')
    expect(event.defaultPrevented).toBe(false)
    expect(openDocsMock).not.toHaveBeenCalled()
  })

  it('detects tauri runtime via __TAURI_INTERNALS__', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(isTauriRuntime()).toBe(true)
  })

  it('prevents default and opens the in-app docs panel for directory routes', () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      location: { origin: 'http://localhost:8517' },
    })
    const event = new MouseEvent('click', { cancelable: true })
    openDocLink(event, '/docs/strategy/')
    expect(event.defaultPrevented).toBe(true)
    expect(openDocsMock).toHaveBeenCalledWith('http://localhost:8517/docs/strategy/')
  })

  it('passes file-route paths through unchanged', () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      location: { origin: 'http://localhost:8517' },
    })
    const event = new MouseEvent('click', { cancelable: true })
    openDocLink(event, '/docs/market-news')
    expect(openDocsMock).toHaveBeenCalledWith('http://localhost:8517/docs/market-news')
  })
})
