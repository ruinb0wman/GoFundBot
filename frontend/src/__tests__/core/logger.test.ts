import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Regression: `sendBeacon(url, string)` sends `text/plain`, which the service's
 * `express.json()` ignores — `/api/logs/ingest` answered 400 and every frontend
 * log entry was silently dropped. The payload must be a JSON Blob.
 */
describe('clientLogger ingest', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('flushes buffered entries as an application/json Blob', async () => {
    const beacon = vi.fn((_url: string, _blob: Blob) => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })

    const { clientLogger } = await import('../../core/logger')
    clientLogger.warn('probe', { a: 1 })
    await vi.advanceTimersByTimeAsync(5000)

    expect(beacon).toHaveBeenCalledTimes(1)
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe('/api/logs/ingest')
    expect(blob.type).toBe('application/json')
    const body = JSON.parse(await blob.text())
    expect(body.entries[0]).toMatchObject({ level: 'warn', message: 'probe', context: { a: 1 } })
  })

  it('falls back to fetch when sendBeacon declines', async () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: vi.fn(() => false), configurable: true })
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)

    const { clientLogger } = await import('../../core/logger')
    clientLogger.info('probe-2')
    await vi.advanceTimersByTimeAsync(5000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/logs/ingest')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.keepalive).toBe(true)
  })
})
