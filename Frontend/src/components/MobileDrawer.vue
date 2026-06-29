<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="isOpen" class="drawer-overlay" @click.self="$emit('close')">
        <aside class="drawer-panel">
          <div class="drawer-header">
            <h2>导航</h2>
            <button class="drawer-close" @click="$emit('close')">
              <LucideIcon name="X" :size="20" />
            </button>
          </div>
          <nav class="drawer-nav">
            <button
              v-for="item in items"
              :key="item.route"
              class="drawer-item"
              :class="{ active: item.route === activeRoute }"
              @click="navigate(item.route)"
            >
              <LucideIcon :name="item.icon" :size="18" />
              <span>{{ item.label }}</span>
            </button>
          </nav>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  isOpen: boolean
  activeRoute: string
}>()

const emit = defineEmits<{ close: [] }>()

const router = useRouter()

const items = [
  { route: 'dashboard', icon: 'Home', label: '市场大盘' },
  { route: 'screening', icon: 'Search', label: '基金筛选' },
  { route: 'backtest', icon: 'Coins', label: '定投回测' },
  { route: 'portfolio', icon: 'BarChart3', label: '估值与持仓' },
  { route: 'research', icon: 'TrendingUp', label: '投研看板' },
]

function navigate(route: string) {
  router.push({ name: route })
  emit('close')
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgba(0, 0, 0, 0.4);
}

.drawer-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  max-width: 80vw;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.15);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.drawer-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.drawer-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 6px;
}

.drawer-close:hover {
  background: var(--bg-subtle);
}

.drawer-nav {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary);
  transition: all 0.15s;
  text-align: left;
}

.drawer-item:hover {
  background: var(--bg-subtle);
}

.drawer-item.active {
  background: var(--color-primary);
  color: #fff;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-active .drawer-panel {
  transition: transform 0.25s ease;
}

.drawer-leave-active .drawer-panel {
  transition: transform 0.2s ease;
}

.drawer-enter-from .drawer-panel {
  transform: translateX(-100%);
}

.drawer-leave-to .drawer-panel {
  transform: translateX(-100%);
}
</style>
