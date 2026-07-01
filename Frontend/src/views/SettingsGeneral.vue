<template>
  <div class="settings-general">
    <section class="setting-section">
      <h3>{{ t('settings.general.appearance') }}</h3>
      <p class="section-desc">{{ t('settings.general.themeDesc') }}</p>
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
      <h3>{{ t('settings.general.language') }}</h3>
      <p class="section-desc">{{ t('settings.general.langDesc') }}</p>
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
import { useI18n } from 'vue-i18n'
import { useTheme } from '../composables/useTheme'
import { getCurrentLocale, setLocale as setAppLocale } from '../locales/index'

const { t } = useI18n()
const { savedTheme, toggleTheme } = useTheme()

const currentLocale = computed(() => getCurrentLocale())

const themeOptions = computed(() => [
  { value: 'light', icon: 'Sun', label: t('theme.light') },
  { value: 'dark', icon: 'Moon', label: t('theme.dark') },
  { value: 'auto', icon: 'Monitor', label: t('theme.auto') },
])

const localeOptions = computed(() => [
  { value: 'zh', label: t('locale.zh') },
  { value: 'en', label: t('locale.en') },
])

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
