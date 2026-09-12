import { describe, expect, it } from 'vitest'
import { docUrl, openDocLink } from '../../services/docLink'

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
  it('does not prevent default in the browser so the anchor opens a new tab', () => {
    const event = new MouseEvent('click', { cancelable: true })
    openDocLink(event, '/docs/strategy/')
    expect(event.defaultPrevented).toBe(false)
  })
})
