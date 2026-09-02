<template>
  <div class="settings-llm">
    <section class="setting-section">
      <h3>{{ 'AI 服务配置' }}</h3>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Key" :size="16" />
          {{ 'API 密钥' }}
        </label>
        <div class="input-with-toggle">
          <input
            :type="showKey ? 'text' : 'password'"
            v-model="form.apiKey"
            :placeholder="'输入你的 API Key（以 sk- 开头）'"
            class="field-input"
          />
          <button class="toggle-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
            <LucideIcon :name="showKey ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Globe" :size="16" />
          {{ 'API 地址' }}
        </label>
        <input
          type="text"
          v-model="form.apiBase"
          :placeholder="'https://api.siliconflow.cn/v1'"
          class="field-input"
        />
      </div>

      <div class="field-group">
        <label class="field-label">
          <LucideIcon name="Cpu" :size="16" />
          {{ '模型' }}
        </label>
        <input
          type="text"
          v-model="form.model"
          :placeholder="'Qwen/Qwen2.5-7B-Instruct'"
          class="field-input"
        />
      </div>

      <div class="action-row">
        <button class="save-btn" @click="handleSave">
          <LucideIcon name="Save" :size="16" />
          {{ '保存' }}
        </button>
        <span v-if="status" class="status-msg" :class="{ success: status === 'saved' }">
          {{ status === 'saved' ? '配置已保存' : '' }}
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useLLMConfig } from '../composables/useLLMConfig'

const { config, saveConfig } = useLLMConfig()

const showKey = ref(false)
const status = ref<'saved' | ''>('')

const form = reactive({ ...config.value })

function handleSave() {
  saveConfig({ ...form })
  status.value = 'saved'
  setTimeout(() => { status.value = '' }, 2000)
}
</script>

<style scoped>
.settings-llm {
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.setting-section {
  max-width: 520px;
}

.setting-section h3 {
  margin: 0 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
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

.status-msg {
  font-size: 13px;
  color: var(--text-tertiary);
}

.status-msg.success {
  color: var(--color-success, #22c55e);
}
</style>
