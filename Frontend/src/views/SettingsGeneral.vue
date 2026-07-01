<template>
  <div class="settings-general">
    <section class="setting-section">
      <h3>外观</h3>
      <p class="section-desc">选择主题显示模式</p>
      <div class="option-group">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          class="option-btn"
          :class="{ active: savedTheme === opt.value }"
          @click="setTheme(opt.value)"
        >
          <LucideIcon :name="opt.icon" :size="20" />
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </section>

    <section class="setting-section">
      <h3>语言</h3>
      <p class="section-desc">选择界面显示语言</p>
      <div class="option-group">
        <button
          v-for="opt in localeOptions"
          :key="opt.value"
          class="option-btn"
          :class="{ active: currentLocale.startsWith(opt.value) }"
          @click="setLocale(opt.value === 'zh' ? 'zh-CN' : 'en')"
        >
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../composables/useTheme'
import { getCurrentLocale, setLocale as setAppLocale } from '../locales/index'

const { savedTheme, toggleTheme } = useTheme()

const currentLocale = computed(() => getCurrentLocale())

const themeOptions = [
  { value: 'light', icon: 'Sun', label: '浅色' },
  { value: 'dark', icon: 'Moon', label: '深色' },
  { value: 'auto', icon: 'Monitor', label: '跟随系统' },
]

const localeOptions = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

function setTheme(mode: string) {
  while (savedTheme.value !== mode) {
    toggleTheme()
  }
}

function setLocale(locale: string) {
  setAppLocale(locale)
}
</script>

<style scoped>
.settings-general {
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.setting-section {
  margin-bottom: 32px;
}

.setting-section:last-child {
  margin-bottom: 0;
}

.setting-section h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.option-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.option-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.option-btn:hover {
  background: var(--bg-hover, var(--bg-card));
  border-color: var(--color-primary);
}

.option-btn.active {
  background: var(--color-primary);
  color: var(--text-inverse);
  border-color: var(--color-primary);
}
</style>
