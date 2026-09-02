<template>
  <div class="settings-general">
    <section class="setting-section">
      <h3>{{ '外观' }}</h3>
      <p class="section-desc">{{ '选择主题显示模式' }}</p>
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../composables/useTheme'

const { savedTheme, toggleTheme } = useTheme()

const themeOptions = computed(() => [
  { value: 'light', icon: 'Sun', label: '浅色模式' },
  { value: 'dark', icon: 'Moon', label: '深色模式' },
  { value: 'auto', icon: 'Monitor', label: '跟随系统' },
])

function setTheme(mode: string) {
  while (savedTheme.value !== mode) {
    toggleTheme()
  }
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
