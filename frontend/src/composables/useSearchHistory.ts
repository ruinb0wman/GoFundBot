import { ref, watch } from 'vue'

const STORAGE_KEY = 'gofundbot_search_history'
const MAX_ITEMS = 10

export interface SearchHistoryItem {
  code: string
  name: string
  type: string
  timestamp: number
}

function loadHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveHistory(items: SearchHistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // storage full or unavailable
  }
}

const searchHistory = ref<SearchHistoryItem[]>(loadHistory())

watch(searchHistory, (val) => {
  saveHistory(val)
}, { deep: true })

export function useSearchHistory() {
  function addToHistory(fund: { CODE?: string; code?: string; NAME?: string; name?: string; TYPE?: string; type?: string }) {
    const code = fund.CODE || fund.code || ''
    const name = fund.NAME || fund.name || ''
    const type = fund.TYPE || fund.type || ''
    if (!code) return

    searchHistory.value = [
      { code, name, type, timestamp: Date.now() },
      ...searchHistory.value.filter(h => h.code !== code),
    ].slice(0, MAX_ITEMS)
  }

  function removeFromHistory(code: string) {
    searchHistory.value = searchHistory.value.filter(h => h.code !== code)
  }

  function clearHistory() {
    searchHistory.value = []
  }

  return {
    searchHistory,
    addToHistory,
    removeFromHistory,
    clearHistory,
  }
}
