import { ref, onMounted, onUnmounted } from 'vue'
import { datasourceScoresAPI } from '../services/api'

const STORAGE_KEY = 'gofund-datasource-scores'
const SYNC_INTERVAL = 120_000

type SourceScores = Record<string, {
  score: number
  lastSuccess: number | null
  lastFailure: number | null
  consecutiveFailures: number
  totalCalls: number
}>

const scores = ref<SourceScores | null>(null)
let syncTimer: ReturnType<typeof setInterval> | null = null

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

async function syncToExpress(): Promise<void> {
  const local = loadLocal()
  if (!local) return
  try {
    await datasourceScoresAPI.update({ scores: local })
  } catch {
    // best-effort
  }
}

async function pullFromExpress(): Promise<void> {
  try {
    const res = await datasourceScoresAPI.get()
    if (res.data?.success && res.data?.data?.scores) {
      scores.value = res.data.data.scores
      saveLocal(res.data.data.scores)
    }
  } catch {
    // best-effort
  }
}

async function init(): Promise<void> {
  await syncToExpress()
  syncTimer = setInterval(pullFromExpress, SYNC_INTERVAL)
}

function destroy(): void {
  if (syncTimer !== null) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

export function useDataSourceScores() {
  return { scores, init, destroy, syncToExpress, pullFromExpress }
}
