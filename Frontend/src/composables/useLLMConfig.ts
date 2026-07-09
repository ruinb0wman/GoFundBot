import { computed, ref, type Ref } from 'vue'

const STORAGE_KEY = 'gofund-llm-config'

export interface LLMConfig {
  apiKey: string
  apiBase: string
  model: string
}

const defaultConfig: LLMConfig = {
  apiKey: '',
  apiBase: 'https://api.siliconflow.cn/v1',
  model: 'Qwen/Qwen2.5-7B-Instruct',
}

const config: Ref<LLMConfig> = ref(loadConfig())

function loadConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) }
  } catch {
    // ignore parse errors
  }
  return { ...defaultConfig }
}

function saveConfig(updated: LLMConfig) {
  config.value = updated
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function useLLMConfig() {
  const isConfigured = computed(() => !!config.value.apiKey)
  return { config, saveConfig, isConfigured }
}
