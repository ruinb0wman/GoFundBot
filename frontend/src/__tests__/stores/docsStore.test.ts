import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDocsStore } from '../../stores/docsStore'

describe('docsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts closed with no src', () => {
    const store = useDocsStore()
    expect(store.open).toBe(false)
    expect(store.src).toBeNull()
  })

  it('writes src and opens on openDocs', () => {
    const store = useDocsStore()
    store.openDocs('http://localhost:8517/docs/strategy/')
    expect(store.open).toBe(true)
    expect(store.src).toBe('http://localhost:8517/docs/strategy/')
  })

  it('resets state on closeDocs', () => {
    const store = useDocsStore()
    store.openDocs('http://localhost:8417/docs/fund-screening/')
    store.closeDocs()
    expect(store.open).toBe(false)
    expect(store.src).toBeNull()
  })
})
