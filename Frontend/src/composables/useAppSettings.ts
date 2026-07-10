import { ref, type Ref } from 'vue'
import { settingsAPI } from '../services/api'

const STORAGE_KEY = 'gofund-app-settings'

export interface AppSettings {
  search: {
    bochaKey: string
    tavilyKey: string
  }
}

const defaultSettings: AppSettings = {
  search: {
    bochaKey: '',
    tavilyKey: '',
  },
}

const settings: Ref<AppSettings> = ref(loadSettings())

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return { ...defaultSettings }
}

async function syncToExpress(): Promise<void> {
  try {
    await settingsAPI.update({
      search: {
        bochaKey: settings.value.search.bochaKey,
        tavilyKey: settings.value.search.tavilyKey,
      },
    })
  } catch {
    // silent — backend sync is best-effort
  }
}

function saveSearchKeys(keys: { bochaKey: string; tavilyKey: string }): void {
  settings.value.search = { ...keys }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
}

export function useAppSettings() {
  return { settings, saveSearchKeys, syncToExpress }
}
