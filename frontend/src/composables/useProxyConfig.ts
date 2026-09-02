import { ref, type Ref } from 'vue'
import { systemAPI, settingsAPI } from '../services/api'

const STORAGE_KEY = 'gofund-proxy-config'

export interface ProxyConfig {
  url: string
}

const defaultConfig: ProxyConfig = {
  url: '',
}

const config: Ref<ProxyConfig> = ref(loadConfig())

function loadConfig(): ProxyConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) }
  } catch {
    // ignore parse errors
  }
  return { ...defaultConfig }
}

async function saveConfig(updated: ProxyConfig) {
  config.value = updated
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  try {
    await systemAPI.updateProxy(updated)
  } catch {
    // silent — backend proxy sync is best-effort
  }
  try {
    await settingsAPI.update({ proxy: updated })
  } catch {
    // silent
  }
}

async function syncFromBackend() {
  try {
    const res = await systemAPI.getProxy()
    if (res.data?.success && res.data?.data) {
      const remote = res.data.data as ProxyConfig
      config.value = { ...remote }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote))
    }
  } catch {
    // silent
  }
}

export function useProxyConfig() {
  return { config, saveConfig, syncFromBackend }
}
