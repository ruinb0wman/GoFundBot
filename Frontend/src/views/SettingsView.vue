<template>
  <div class="settings-page">
    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        class="settings-tab"
        :class="{ active: route.name === tab.name }"
        @click="router.push({ name: tab.name })"
      >
        <LucideIcon :name="tab.icon" :size="18" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
    <div class="settings-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const tabs = [
  { name: 'settings-general', icon: 'Settings', label: '通用' },
  { name: 'settings-logs', icon: 'FileText', label: '日志' },
  { name: 'settings-sqlite-admin', icon: 'Database', label: '数据库管理' },
]
</script>

<style scoped>
.settings-page {
  display: flex;
  gap: 0;
  min-height: calc(100vh - 120px);
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.settings-tabs {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  height: fit-content;
  position: sticky;
  top: 80px;
}

.settings-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
  transition: all 0.15s;
  text-align: left;
}

.settings-tab:hover {
  background: var(--bg-subtle);
}

.settings-tab.active {
  background: var(--color-primary);
  color: var(--text-inverse);
}

.settings-content {
  flex: 1;
  margin-left: 20px;
  min-width: 0;
}

@media (max-width: 768px) {
  .settings-page {
    flex-direction: column;
    padding: 12px;
  }

  .settings-tabs {
    width: 100%;
    flex-direction: row;
    position: static;
    overflow-x: auto;
    gap: 4px;
    padding: 6px;
    margin-bottom: 12px;
  }

  .settings-tab {
    white-space: nowrap;
    padding: 8px 12px;
    font-size: 13px;
  }

  .settings-content {
    margin-left: 0;
  }
}
</style>
