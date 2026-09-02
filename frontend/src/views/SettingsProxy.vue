<template>
  <div class="settings-proxy">
    <section class="setting-section">
      <h3>{{ '网络代理配置' }}</h3>
      <p class="section-desc">{{ '配置 HTTP 代理，用于访问东方财富等外部数据源（本机网络 DNS 劫持时需要）' }}</p>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Globe" :size="16" />
          {{ '代理地址' }}
        </label>
        <input
          type="text"
          v-model="form.url"
          :placeholder="'http://127.0.0.1:7890'"
          class="field-input"
        />
      </div>

      <div class="checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="enabled" @change="onEnabledChange" />
          <span>{{ '不使用代理' }}</span>
        </label>
      </div>

      <div class="action-row">
        <button class="save-btn" @click="handleSave" :disabled="saving">
          <LucideIcon name="Save" :size="16" />
          {{ '保存' }}
        </button>
        <span v-if="status" class="status-msg" :class="{ success: status === 'saved', error: status === 'error' }">
          {{ statusText }}
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useProxyConfig } from '../composables/useProxyConfig'

const { config, saveConfig, syncFromBackend } = useProxyConfig()

const enabled = ref(!!config.value.url)
const form = reactive({ url: config.value.url })
const saving = ref(false)
const status = ref<'saved' | 'error' | ''>('')
const statusText = ref('')

function onEnabledChange() {
  if (!enabled.value) {
    form.url = ''
  }
}

watch(() => config.value.url, (val) => {
  form.url = val
  enabled.value = !!val
})

async function handleSave() {
  saving.value = true
  status.value = ''
  try {
    await saveConfig({ url: form.url.trim() })
    status.value = 'saved'
    statusText.value = '代理配置已保存'
  } catch {
    status.value = 'error'
    statusText.value = '保存失败'
  } finally {
    saving.value = false
    setTimeout(() => { status.value = '' }, 2000)
  }
}

onMounted(async () => {
  await syncFromBackend()
  form.url = config.value.url
  enabled.value = !!config.value.url
})
</script>

<style scoped>
.settings-proxy {
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

.checkbox-group {
  margin-bottom: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
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
  color: var(--text-tertiary);
}

.status-msg.success {
  color: var(--color-success, #22c55e);
}

.status-msg.error {
  color: var(--color-danger, #ef4444);
}
</style>
