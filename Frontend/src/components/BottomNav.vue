<template>
  <nav class="bottom-nav">
    <button
      v-for="item in items"
      :key="item.route"
      class="bottom-nav-item"
      :class="{ active: isActive(item.route) }"
      @click="navigate(item.route)"
    >
      <LucideIcon :name="item.icon" :size="20" />
      <span class="bottom-nav-label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useBreakpoint } from '../composables/useBreakpoint'

const route = useRoute()
const router = useRouter()
const { isMobile } = useBreakpoint()

const items = [
  { route: 'dashboard', icon: 'Home', label: '大盘' },
  { route: 'screening', icon: 'Search', label: '筛选' },
  { route: 'backtest', icon: 'Coins', label: '回测' },
  { route: 'portfolio', icon: 'BarChart3', label: '持仓' },
  { route: 'research', icon: 'TrendingUp', label: '投研' },
]

function isActive(name: string): boolean {
  if (!route.name) return false
  return String(route.name).startsWith(name)
}

function navigate(name: string) {
  router.push({ name })
}
</script>

<style scoped>
.bottom-nav {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 4000;
  background: var(--bg-card);
  border-top: 1px solid var(--border-default);
  padding: 4px 0;
  padding-bottom: max(4px, env(safe-area-inset-bottom));
  justify-content: space-around;
}

@media (max-width: 768px) {
  .bottom-nav {
    display: flex;
  }
}

.bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: color 0.15s;
  min-width: 48px;
  min-height: 44px;
}

.bottom-nav-item:hover {
  color: var(--text-secondary);
}

.bottom-nav-item.active {
  color: var(--color-primary);
}

.bottom-nav-label {
  font-size: 10px;
  line-height: 1;
}
</style>
