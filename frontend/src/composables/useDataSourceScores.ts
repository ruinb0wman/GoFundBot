import { ref } from 'vue'

const STORAGE_KEY = 'gofund-datasource-scores'

type SourceScores = Record<string, {
  score: number
  lastSuccess: number | null
  lastFailure: number | null
  consecutiveFailures: number
  totalCalls: number
}>

const scores = ref<SourceScores | null>(null)

function loadLocal(): SourceScores | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveLocal(data: SourceScores): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // quota exceeded — silent
  }
}

// Datasource scores now live entirely in the frontend (localStorage).
function init(): void {
  scores.value = loadLocal()
}

function destroy(): void {
  // no-op — kept for API compat
}

export function useDataSourceScores() {
  return { scores, init, destroy }
}
