<template>
  <div class="settings-search">
    <section class="setting-section">
      <h3>搜索 API 配置</h3>
      <p class="section-desc">
        配置搜索 API 后可获取更准确的新闻和政策搜索结果。
        未配置时自动使用 DuckDuckGo 免费搜索（无需 Key）。
      </p>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Key" :size="16" />
          Bocha API Key
        </label>
        <div class="input-with-toggle">
          <input
            :type="showBochaKey ? 'text' : 'password'"
            v-model="form.bochaKey"
            placeholder="bocha.cn 免费注册获取"
            class="field-input"
          />
          <button class="toggle-btn" @click="showBochaKey = !showBochaKey" :title="showBochaKey ? '隐藏' : '显示'">
            <LucideIcon :name="showBochaKey ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>
        <p class="field-hint">推荐：中文搜索质量最优，free.bocha.ai 注册获取</p>
      </div>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Key" :size="16" />
          Tavily API Key
        </label>
        <div class="input-with-toggle">
          <input
            :type="showTavilyKey ? 'text' : 'password'"
            v-model="form.tavilyKey"
            placeholder="tavily.com 注册获取"
            class="field-input"
          />
          <button class="toggle-btn" @click="showTavilyKey = !showTavilyKey" :title="showTavilyKey ? '隐藏' : '显示'">
            <LucideIcon :name="showTavilyKey ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>
        <p class="field-hint">备选：Tavily AI 搜索，1000次/月免费</p>
      </div>

      <div class="fallback-info">
        <LucideIcon name="Info" :size="14" />
        <span>未配置 API Key 时自动使用 DuckDuckGo 免费搜索（无需注册）</span>
      </div>

      <div class="action-row">
        <button class="save-btn" @click="handleSave" :disabled="saving">
          <LucideIcon name="Save" :size="16" />
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <span v-if="status" class="status-msg" :class="{ success: status === 'saved', error: status === 'error' }">
          {{ statusText }}
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useAppSettings } from '../composables/useAppSettings'

const { settings, saveSearchKeys } = useAppSettings()

const showBochaKey = ref(false)
const showTavilyKey = ref(false)
const saving = ref(false)
const status = ref<'saved' | 'error' | ''>('')
const statusText = ref('')

const form = reactive({
  bochaKey: settings.value.search.bochaKey,
  tavilyKey: settings.value.search.tavilyKey,
})

async function handleSave() {
  saving.value = true
  status.value = ''
  try {
    saveSearchKeys({
      bochaKey: form.bochaKey.trim(),
      tavilyKey: form.tavilyKey.trim(),
    })
    status.value = 'saved'
    statusText.value = '配置已保存'
  } catch {
    status.value = 'error'
    statusText.value = '保存失败'
  } finally {
    saving.value = false
    setTimeout(() => { status.value = '' }, 2000)
  }
}
</script>

<style scoped>
.settings-search {
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.setting-section {
  max-width: 520px;
}

.setting-section h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.field-group {
  margin-bottom: 16px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.field-input:focus {
  border-color: var(--color-primary);
}

.input-with-toggle {
  display: flex;
  align-items: center;
  gap: 0;
}

.input-with-toggle .field-input {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-default);
  border-radius: 0 6px 6px 0;
  background: var(--bg-subtle);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}

.toggle-btn:hover {
  color: var(--text-primary);
}

.field-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.fallback-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.save-btn:hover {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-msg {
  font-size: 13px;
}

.status-msg.success {
  color: var(--color-success, #22c55e);
}

.status-msg.error {
  color: var(--color-danger, #ef4444);
}
</style>
